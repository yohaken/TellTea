/**
 * อัปเดต bonusLivePool/{YYYY-MM} อัตโนมัติเมื่อมีชง/ผลิต/หักโบนัส/เรท
 * พนักงานอ่านพูลนี้คำนวณส่วนแบ่งขาย — ไม่ต้องรอเจ้าของเปิดหน้าโบนัส
 */
const functions = require("firebase-functions/v1");
const { getFirestore } = require("firebase-admin/firestore");

const REGION = "asia-southeast1";
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DEFAULT_BAKERY_SALES_RATE = 0.6;
const DEFAULT_DEDUCTION_RULES = [
  { id: "generalFail", pctPerUnit: 1 },
  { id: "waste", pctPerUnit: 3 },
];

/** กัน trigger ซ้ำถี่ๆ ต่อเดือน (instance-local) */
const recentRefresh = new Map();
const MIN_REFRESH_GAP_MS = 8_000;

function bangkokCalendarParts(ms) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(Number(ms) || 0));
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  return {
    y: Number(get("year")),
    m: Number(get("month")),
  };
}

function periodMonthFromDateMs(ms) {
  const { y, m } = bangkokCalendarParts(ms);
  return `${y}-${String(m).padStart(2, "0")}`;
}

function monthBoundsBangkok(periodMonth) {
  const [y, m] = periodMonth.split("-").map(Number);
  if (!y || !m) return null;
  return {
    since: Date.UTC(y, m - 1, 1) - BANGKOK_OFFSET_MS,
    until: Date.UTC(y, m, 1) - BANGKOK_OFFSET_MS,
    year: y,
    month: m - 1,
  };
}

function isInMonthBangkok(ms, year, monthIdx) {
  const p = bangkokCalendarParts(ms);
  return p.y === year && p.m === monthIdx + 1;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function namesMatch(a, b) {
  const x = String(a || "").trim().toLowerCase();
  const y = String(b || "").trim().toLowerCase();
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

function employeeMatchesName(emp, rawName) {
  if (!rawName || !String(rawName).trim()) return false;
  if (namesMatch(emp.name, rawName)) return true;
  if (emp.nickname && namesMatch(emp.nickname, rawName)) return true;
  return (emp.previousNames || []).some((n) => namesMatch(n, rawName));
}

function findEmployeeByWorkedName(roster, rawName) {
  return roster.find((e) => employeeMatchesName(e, rawName));
}

function resolveRateForDate(entries, kind, dateMs) {
  const day = Number(dateMs) || 0;
  let best = null;
  for (const row of entries) {
    if (row.kind !== kind) continue;
    if (row.effectiveFrom > day) continue;
    if (
      !best ||
      row.effectiveFrom > best.effectiveFrom ||
      (row.effectiveFrom === best.effectiveFrom && row.createdAt > best.createdAt)
    ) {
      best = row;
    }
  }
  return best;
}

function computeBakerySalesPool(prodRows, schedule) {
  let totalProdQty = 0;
  let totalSalesPool = 0;
  for (const row of prodRows) {
    const qty = Number(row.qtyProduced) || 0;
    if (qty <= 0) continue;
    totalProdQty += qty;
    const hit = resolveRateForDate(schedule, "bakerySales", row.date);
    const rate = hit ? Number(hit.rate) || 0 : DEFAULT_BAKERY_SALES_RATE;
    totalSalesPool += qty * rate;
  }
  return {
    totalProdQty: round2(totalProdQty),
    totalSalesPool: round2(totalSalesPool),
  };
}

function computeShopDeductPct(counts, rules) {
  let raw = 0;
  for (const rule of rules) {
    const qty = Math.max(0, Number(counts[rule.id]) || 0);
    raw += qty * (Number(rule.pctPerUnit) || 0);
  }
  return Math.min(100, round2(raw));
}

function countWorkersWhoWorked(otRows, prodRows, employees) {
  const active = employees.filter((e) => e.active !== false);
  const worked = new Set();

  function creditWorkers(row) {
    const credited = new Set();
    const ids = row.workerIds || [];
    for (const id of ids) {
      const emp =
        active.find((e) => e.id === id) || employees.find((e) => e.id === id);
      if (emp) {
        worked.add(emp.id);
        credited.add(emp.id);
      }
    }
    for (const rawName of row.workerNames || []) {
      const matched =
        findEmployeeByWorkedName(active, rawName) ||
        findEmployeeByWorkedName(employees, rawName);
      if (matched) {
        if (!credited.has(matched.id)) worked.add(matched.id);
        continue;
      }
      if (ids.length > 0) continue;
      worked.add(`name:${String(rawName).trim().toLowerCase()}`);
    }
  }

  for (const row of otRows) creditWorkers(row);
  for (const row of prodRows) creditWorkers(row);
  return worked.size;
}

async function loadEmployees(db) {
  const snap = await db.collection("employees").orderBy("name").get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function loadEntriesForMonth(db, col, since, until) {
  const snap = await db
    .collection(col)
    .where("date", ">=", since)
    .where("date", "<", until)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function loadDeductionSettings(db) {
  const snap = await db.doc("meta/bonusDeductionSettings").get();
  const data = snap.exists ? snap.data() : {};
  const rules = DEFAULT_DEDUCTION_RULES.map((fallback) => {
    const hit = (data.rules || []).find((r) => r.id === fallback.id);
    return {
      id: fallback.id,
      pctPerUnit: Math.max(0, Number(hit?.pctPerUnit) || fallback.pctPerUnit),
    };
  });
  return rules;
}

async function loadDeductionMonth(db, periodMonth) {
  const snap = await db.doc(`bonusDeductionMonths/${periodMonth}`).get();
  const data = snap.exists ? snap.data() : {};
  return {
    generalFail: Math.max(0, Number(data.counts?.generalFail) || 0),
    waste: Math.max(0, Number(data.counts?.waste) || 0),
  };
}

async function loadRateSchedule(db) {
  const snap = await db.doc("meta/rateSchedule").get();
  if (!snap.exists) return [];
  const entries = snap.get("entries");
  return Array.isArray(entries) ? entries : [];
}

async function isMonthClosed(db, periodMonth) {
  const snap = await db.doc(`bonusMonthStatus/${periodMonth}`).get();
  return snap.exists && snap.get("status") === "closed";
}

/**
 * คำนวณและเขียน bonusLivePool — ใช้ Admin SDK (ไม่ผูก client / ไม่ต้องเปิดหน้าโบนัส)
 */
async function refreshBonusLivePoolForMonth(db, periodMonth) {
  if (!/^\d{4}-\d{2}$/.test(periodMonth)) return { skipped: true, reason: "bad-month" };
  const bounds = monthBoundsBangkok(periodMonth);
  if (!bounds) return { skipped: true, reason: "bad-bounds" };

  if (await isMonthClosed(db, periodMonth)) {
    return { skipped: true, reason: "month-closed", periodMonth };
  }

  const now = Date.now();
  const last = recentRefresh.get(periodMonth) || 0;
  if (now - last < MIN_REFRESH_GAP_MS) {
    return { skipped: true, reason: "debounced", periodMonth };
  }
  recentRefresh.set(periodMonth, now);

  const [employees, otAll, prodAll, rules, counts, schedule] = await Promise.all([
    loadEmployees(db),
    loadEntriesForMonth(db, "otEntries", bounds.since, bounds.until),
    loadEntriesForMonth(db, "prodEntries", bounds.since, bounds.until),
    loadDeductionSettings(db),
    loadDeductionMonth(db, periodMonth),
    loadRateSchedule(db),
  ]);

  const otMonth = otAll.filter((e) => isInMonthBangkok(e.date, bounds.year, bounds.month));
  const prodMonth = prodAll.filter((e) => isInMonthBangkok(e.date, bounds.year, bounds.month));
  const { totalProdQty, totalSalesPool } = computeBakerySalesPool(prodMonth, schedule);
  const employeeCount = countWorkersWhoWorked(otMonth, prodMonth, employees);
  const shopDeductPct = computeShopDeductPct(counts, rules);

  await db.doc(`bonusLivePool/${periodMonth}`).set(
    {
      periodMonth,
      totalSalesPool,
      totalProdQty,
      employeeCount,
      shopDeductPct,
      updatedAt: Date.now(),
      syncedBy: "cloud",
    },
    { merge: true },
  );

  return {
    ok: true,
    periodMonth,
    totalSalesPool,
    totalProdQty,
    employeeCount,
    shopDeductPct,
  };
}

function periodMonthsFromChange(before, after) {
  const months = new Set();
  const dates = [];
  if (after?.exists) dates.push(Number(after.get("date")) || 0);
  if (before?.exists) dates.push(Number(before.get("date")) || 0);
  for (const ms of dates) {
    if (ms > 0) months.add(periodMonthFromDateMs(ms));
  }
  return [...months];
}

async function refreshFromEntryWrite(change) {
  const db = getFirestore();
  const months = periodMonthsFromChange(change.before, change.after);
  if (!months.length) return null;
  const results = [];
  for (const month of months) {
    results.push(await refreshBonusLivePoolForMonth(db, month));
  }
  return results;
}

async function refreshFromRateSchedule(change) {
  if (!change.after.exists) return null;
  const db = getFirestore();
  const now = periodMonthFromDateMs(Date.now());
  const [y, m] = now.split("-").map(Number);
  const prev =
    m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  const results = [];
  for (const month of [now, prev]) {
    results.push(await refreshBonusLivePoolForMonth(db, month));
  }
  return results;
}

exports.refreshBonusLivePoolForMonth = refreshBonusLivePoolForMonth;

exports.onProdEntryWrittenForBonusPool = functions
  .region(REGION)
  .firestore.document("prodEntries/{id}")
  .onWrite(refreshFromEntryWrite);

exports.onOtEntryWrittenForBonusPool = functions
  .region(REGION)
  .firestore.document("otEntries/{id}")
  .onWrite(refreshFromEntryWrite);

exports.onBonusDeductionMonthWrittenForBonusPool = functions
  .region(REGION)
  .firestore.document("bonusDeductionMonths/{monthKey}")
  .onWrite(async (_change, context) => {
    const monthKey = context.params.monthKey;
    if (!monthKey) return null;
    return refreshBonusLivePoolForMonth(getFirestore(), monthKey);
  });

exports.onRateScheduleWrittenForBonusPool = functions
  .region(REGION)
  .firestore.document("meta/rateSchedule")
  .onWrite(refreshFromRateSchedule);

/** สำรอง — รีเฟรชเดือนปัจจุบันทุกชั่วโมง กัน trigger พลาด */
exports.bonusLivePoolHourly = functions
  .region(REGION)
  .pubsub.schedule("every 60 minutes")
  .timeZone("Asia/Bangkok")
  .onRun(async () => {
    const periodMonth = periodMonthFromDateMs(Date.now());
    return refreshBonusLivePoolForMonth(getFirestore(), periodMonth);
  });
