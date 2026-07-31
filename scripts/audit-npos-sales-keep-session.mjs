/**
 * Audit leftover nPos sales/sessions vs one keep session code (BO display code).
 *
 * Session code = last 12 chars of session id (posSessionCode), e.g. 785414397411.
 *
 * Dry-read only — never deletes.
 *
 *   FIREBASE_SERVICE_ACCOUNT='{...}' KEEP_SESSION_CODE=785414397411 \
 *     node scripts/audit-npos-sales-keep-session.mjs
 *
 * Optional: OUT_DIR=artifacts/npos-sales-audit
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const PROJECT = process.env.FIREBASE_PROJECT_ID || "mypeer-501909";
const KEEP_CODE = (process.env.KEEP_SESSION_CODE || "785414397411")
  .trim()
  .toUpperCase()
  .replace(/^#/, "");
const OUT_DIR =
  process.env.OUT_DIR || "/opt/cursor/artifacts/npos-sales-audit";

function loadCredentials() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_KEY;
  if (raw && raw.trim().startsWith("{")) return JSON.parse(raw);
  return undefined;
}

function getAdminDb() {
  if (!getApps().length) {
    const credentials = loadCredentials();
    if (!credentials) throw new Error("ต้องมี FIREBASE_SERVICE_ACCOUNT");
    initializeApp({ credential: cert(credentials), projectId: PROJECT });
  }
  return getFirestore();
}

function asString(v, max = 200) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

function toMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof value.toMillis === "function") return value.toMillis();
  return 0;
}

/** Same as src/lib/pos-sales-report.ts posSessionCode */
function posSessionCode(sessionId) {
  const id = String(sessionId || "").trim();
  if (!id) return "—";
  if (id.length <= 16) return id.toUpperCase();
  return id.slice(-12).toUpperCase();
}

function pairingCodeFromId(id) {
  return String(id || "")
    .replace(/-/g, "")
    .slice(-6)
    .toUpperCase();
}

function devicePairingCode(id, data) {
  const raw =
    typeof data?.pairingCode === "string" ? data.pairingCode.trim().toUpperCase() : "";
  if (raw.length >= 4) return raw;
  return pairingCodeFromId(id);
}

function iso(ms) {
  if (!ms) return null;
  return new Date(ms).toISOString();
}

async function main() {
  const db = getAdminDb();
  const [devicesSnap, sessionsSnap, salesSnap, mutationsSnap, rankSnap] =
    await Promise.all([
      db.collection("posDevices").get(),
      db.collection("posSessions").get(),
      db.collection("posSales").get(),
      db.collection("posSaleMutations").get(),
      db.doc("meta/posMenuRank").get(),
    ]);

  const devices = devicesSnap.docs.map((d) => {
    const data = d.data() || {};
    return {
      id: d.id,
      pairingCode: devicePairingCode(d.id, data),
      label: asString(data.label, 80),
      deviceHint: asString(data.deviceHint, 80),
    };
  });

  const sessions = sessionsSnap.docs.map((d) => {
    const data = d.data() || {};
    const id = d.id;
    return {
      id,
      code: posSessionCode(id),
      deviceId: asString(data.deviceId, 80),
      status: asString(data.status, 24) || "—",
      openedAt: toMs(data.openedAt),
      closedAt: toMs(data.closedAt),
      saleCount: typeof data.saleCount === "number" ? data.saleCount : null,
      totalSales: typeof data.totalSales === "number" ? data.totalSales : null,
      cashTotal: typeof data.cashTotal === "number" ? data.cashTotal : null,
      promptpayTotal:
        typeof data.promptpayTotal === "number" ? data.promptpayTotal : null,
    };
  });

  const keepSessions = sessions.filter((s) => s.code === KEEP_CODE);
  const keepSessionIds = new Set(keepSessions.map((s) => s.id));

  const salesBySession = new Map();
  const orphanSales = [];
  const outsideKeepSales = [];
  let completedKeep = 0;
  let voidedKeep = 0;
  let completedOutside = 0;
  let voidedOutside = 0;

  for (const docSnap of salesSnap.docs) {
    const data = docSnap.data() || {};
    const sessionId = asString(data.sessionId, 120);
    const status = asString(data.status, 24) || "—";
    const total = typeof data.total === "number" ? data.total : 0;
    const createdAt = toMs(data.createdAt);
    const deviceId = asString(data.deviceId, 80);
    const billNo = asString(data.billNo, 40);
    const row = {
      id: docSnap.id,
      sessionId,
      sessionCode: posSessionCode(sessionId),
      status,
      total,
      createdAt,
      createdAtIso: iso(createdAt),
      deviceId,
      billNo,
    };

    if (!sessionId) {
      orphanSales.push(row);
    } else {
      const list = salesBySession.get(sessionId) || [];
      list.push(row);
      salesBySession.set(sessionId, list);
    }

    if (keepSessionIds.has(sessionId)) {
      if (status === "voided") voidedKeep += 1;
      else completedKeep += 1;
    } else {
      outsideKeepSales.push(row);
      if (status === "voided") voidedOutside += 1;
      else completedOutside += 1;
    }
  }

  const sessionSummaries = sessions
    .map((s) => {
      const bills = salesBySession.get(s.id) || [];
      const completed = bills.filter((b) => b.status !== "voided");
      const voided = bills.filter((b) => b.status === "voided");
      const sum = completed.reduce((a, b) => a + (b.total || 0), 0);
      return {
        ...s,
        openedAtIso: iso(s.openedAt),
        closedAtIso: iso(s.closedAt),
        billsInDb: bills.length,
        completedBills: completed.length,
        voidedBills: voided.length,
        completedTotal: Math.round(sum * 100) / 100,
        isKeep: keepSessionIds.has(s.id),
      };
    })
    .sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0));

  // Sales whose session doc is missing
  const sessionIdSet = new Set(sessions.map((s) => s.id));
  const salesMissingSessionDoc = [];
  for (const [sessionId, bills] of salesBySession.entries()) {
    if (!sessionIdSet.has(sessionId)) {
      for (const b of bills) salesMissingSessionDoc.push(b);
    }
  }

  // Mutations store saleId (not sessionId) — classify via keep sale ids.
  const keepSaleIds = new Set();
  for (const docSnap of salesSnap.docs) {
    const sessionId = asString((docSnap.data() || {}).sessionId, 120);
    if (keepSessionIds.has(sessionId)) keepSaleIds.add(docSnap.id);
  }

  const mutationsOutside = [];
  let mutationsKeep = 0;
  let mutationsNoSaleId = 0;
  for (const docSnap of mutationsSnap.docs) {
    const data = docSnap.data() || {};
    const saleId = asString(data.saleId, 80);
    const sessionId = asString(data.sessionId, 120);
    if (saleId && keepSaleIds.has(saleId)) {
      mutationsKeep += 1;
      continue;
    }
    if (!saleId) mutationsNoSaleId += 1;
    mutationsOutside.push({
      id: docSnap.id,
      saleId: saleId || null,
      sessionId: sessionId || null,
      sessionCode: sessionId ? posSessionCode(sessionId) : "—",
      deviceId: asString(data.deviceId, 80),
    });
  }

  const rank = rankSnap.exists ? rankSnap.data() || {} : null;
  const rankItems = Array.isArray(rank?.items) ? rank.items : [];
  const rankCats = Array.isArray(rank?.categories) ? rank.categories : [];

  const report = {
    at: new Date().toISOString(),
    project: PROJECT,
    keepSessionCode: KEEP_CODE,
    keepSessionMatchCount: keepSessions.length,
    keepSessions: keepSessions.map((s) => ({
      id: s.id,
      code: s.code,
      deviceId: s.deviceId,
      status: s.status,
      openedAtIso: iso(s.openedAt),
      closedAtIso: iso(s.closedAt),
      saleCount: s.saleCount,
      totalSales: s.totalSales,
    })),
    counts: {
      devices: devices.length,
      sessions: sessions.length,
      sales: salesSnap.size,
      mutations: mutationsSnap.size,
      keepSalesCompleted: completedKeep,
      keepSalesVoided: voidedKeep,
      outsideKeepSalesCompleted: completedOutside,
      outsideKeepSalesVoided: voidedOutside,
      orphanSalesNoSessionId: orphanSales.length,
      salesMissingSessionDoc: salesMissingSessionDoc.length,
      mutationsKeep,
      mutationsOutside: mutationsOutside.length,
      mutationsNoSaleId,
      keepSaleIds: keepSaleIds.size,
    },
    leftoverProblem:
      completedOutside +
        voidedOutside +
        orphanSales.length +
        salesMissingSessionDoc.length +
        mutationsOutside.length +
        (sessions.length - keepSessions.length) >
      0,
    devices,
    sessions: sessionSummaries,
    outsideKeepSalesSample: outsideKeepSales
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 40),
    orphanSalesSample: orphanSales.slice(0, 20),
    salesMissingSessionDocSample: salesMissingSessionDoc.slice(0, 20),
    mutationsOutsideSample: mutationsOutside.slice(0, 20),
    posMenuRank: rank
      ? {
          updatedAt: rank.updatedAt ?? null,
          updatedAtIso: iso(toMs(rank.updatedAt)),
          windowDays: rank.windowDays ?? null,
          itemCount: rankItems.length,
          categoryCount: rankCats.length,
          topItems: rankItems.slice(0, 12).map((it) => ({
            menuItemId: it.menuItemId || it.id || null,
            name: it.name || null,
            qty: it.qty ?? it.score ?? null,
            categoryId: it.categoryId || null,
          })),
          purgedReason: rank.purgedReason || null,
        }
      : null,
    interpretation: {
      note:
        "purge_dev_devices / purge-npos-sales-keep เก็บทั้งเครื่อง 570F0F — " +
        "บิลเทสบนเครื่องจริงจึงยังอยู่ได้แม้เหลือรอบเดียวบน UI",
      keepCodeMeans: "เทียบกับ posSessionCode = 12 ตัวท้ายของ session id",
      ifLeftover:
        "ถ้า outsideKeep* > 0 แปลว่ายังมีบิล/รอบนอก 785414397411 ใน Firestore",
    },
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, "npos-sales-keep-session-audit.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(JSON.stringify(report, null, 2));
  console.log(`\nWrote ${outPath}`);

  if (report.leftoverProblem) {
    console.error(
      `\nLEFTOVER: sessions=${sessions.length} keep=${keepSessions.length} ` +
        `outsideSales=${outsideKeepSales.length} orphan=${orphanSales.length} ` +
        `missingSessionDoc=${salesMissingSessionDoc.length}`,
    );
    // exit 0 — audit should not fail the job; leftover is the finding
  } else {
    console.log("\nCLEAN: only keep session (+ its sales) remain");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
