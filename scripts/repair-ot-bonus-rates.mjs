/**
 * Repair OT bonusRate stamps + ensure rate schedule history
 * (0.6 before 2026-07-17, new rate from cutover).
 *
 *   FIREBASE_SERVICE_ACCOUNT='{...}' node scripts/repair-ot-bonus-rates.mjs
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT = process.env.FIREBASE_PROJECT_ID || "mypeer-501909";
const CUTOVER = "2026-07-17";
const LEGACY_RATE = 0.6;
const LEGACY_FROM = "2020-01-01";
const NEW_RATE_DEFAULT = 1;

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

function parseDateInput(value) {
  const [y, m, day] = value.split("-").map(Number);
  return new Date(y, m - 1, day).getTime();
}

function ratesClose(a, b) {
  return Math.abs(Number(a) - Number(b)) < 0.0005;
}

function resolveOt(entries, dateMs) {
  let best = null;
  for (const row of entries) {
    if (row.kind !== "ot") continue;
    if (row.effectiveFrom > dateMs) continue;
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

function newId() {
  return `rate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function stripUndefined(row) {
  const out = {
    id: String(row.id || ""),
    kind: row.kind,
    effectiveFrom: Number(row.effectiveFrom) || 0,
    rate: Number(row.rate) || 0,
    createdAt: Number(row.createdAt) || 0,
    createdBy: String(row.createdBy || ""),
  };
  if (row.productId) out.productId = String(row.productId);
  if (row.productName) out.productName = String(row.productName);
  if (row.note) out.note = String(row.note);
  return out;
}

async function main() {
  const db = getAdminDb();
  const cutoverMs = parseDateInput(CUTOVER);
  const dayBefore = (() => {
    const d = new Date(cutoverMs);
    d.setDate(d.getDate() - 1);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  })();
  const legacyFrom = parseDateInput(LEGACY_FROM);

  const scheduleRef = db.collection("meta").doc("rateSchedule");
  const scheduleSnap = await scheduleRef.get();
  const raw = scheduleSnap.exists ? scheduleSnap.data() : { entries: [] };
  let entries = Array.isArray(raw.entries) ? [...raw.entries] : [];

  const settingsSnap = await db.collection("meta").doc("otSettings").get();
  const settingsRate = Number(settingsSnap.data()?.bonusRate) || NEW_RATE_DEFAULT;
  const todayHit = resolveOt(entries, Date.now());
  const newRate =
    todayHit && todayHit.effectiveFrom >= cutoverMs ? Number(todayHit.rate) : settingsRate || NEW_RATE_DEFAULT;

  entries = entries.filter((e) => {
    if (e.kind !== "ot") return true;
    if (Number(e.effectiveFrom) >= cutoverMs) return true;
    return ratesClose(e.rate, LEGACY_RATE);
  });

  const beforeHit = resolveOt(entries, dayBefore);
  if (!beforeHit || !ratesClose(beforeHit.rate, LEGACY_RATE)) {
    entries.push({
      id: newId(),
      kind: "ot",
      effectiveFrom: legacyFrom,
      rate: LEGACY_RATE,
      note: "เรทเดิม 0.6 (ก่อนปรับ 17 ก.ค.)",
      createdAt: Date.now(),
      createdBy: "script-repair",
    });
  }

  const onCutover = resolveOt(entries, cutoverMs);
  if (!onCutover || !ratesClose(onCutover.rate, newRate)) {
    entries.push({
      id: newId(),
      kind: "ot",
      effectiveFrom: cutoverMs,
      rate: newRate,
      note: "เรทใหม่ตั้งแต่ 17 ก.ค.",
      createdAt: Date.now() + 1,
      createdBy: "script-repair",
    });
  }

  await scheduleRef.set(
    {
      entries: entries.map(stripUndefined),
      updatedAt: Date.now(),
    },
    { merge: false },
  );
  const otSched = entries.filter((e) => e.kind === "ot").sort((a, b) => a.effectiveFrom - b.effectiveFrom);
  console.log("schedule ot rows:", otSched.length, "newRate=", newRate);
  for (const row of otSched) {
    console.log(
      "  schedule",
      new Date(row.effectiveFrom).toLocaleDateString("th-TH"),
      "rate=",
      row.rate,
      row.note || "",
    );
  }

  const otSnap = await db.collection("otEntries").get();

  function summarize(label, docs, scheduleEntries) {
    let beforeOk = 0;
    let beforeBad = 0;
    let afterOk = 0;
    let afterBad = 0;
    const badSamples = [];
    for (const d of docs) {
      const data = d.data();
      const dateMs = Number(data.date) || 0;
      const currentRate = Number(data.bonusRate) || 0;
      const hit = resolveOt(scheduleEntries, dateMs);
      const correct = hit ? Number(hit.rate) : LEGACY_RATE;
      const ok = ratesClose(currentRate, correct);
      if (dateMs < cutoverMs) {
        if (ok) beforeOk += 1;
        else {
          beforeBad += 1;
          if (badSamples.length < 8) {
            badSamples.push({
              id: d.id,
              date: new Date(dateMs).toLocaleDateString("th-TH"),
              rate: currentRate,
              expect: correct,
            });
          }
        }
      } else if (ok) afterOk += 1;
      else {
        afterBad += 1;
        if (badSamples.length < 8) {
          badSamples.push({
            id: d.id,
            date: new Date(dateMs).toLocaleDateString("th-TH"),
            rate: currentRate,
            expect: correct,
          });
        }
      }
    }
    console.log(`=== ${label} ===`);
    console.log(
      `before ${CUTOVER}: ok=${beforeOk} bad=${beforeBad} | from ${CUTOVER}: ok=${afterOk} bad=${afterBad} | total=${docs.length}`,
    );
    for (const s of badSamples) {
      console.log("  BAD", s.id, s.date, "rate=", s.rate, "expect=", s.expect);
    }
    return { beforeOk, beforeBad, afterOk, afterBad };
  }

  summarize("BEFORE repair", otSnap.docs, entries);

  let updated = 0;
  let batch = db.batch();
  let ops = 0;
  const now = Date.now();

  for (const d of otSnap.docs) {
    const data = d.data();
    const dateMs = Number(data.date) || 0;
    const currentRate = Number(data.bonusRate) || 0;
    const hit = resolveOt(entries, dateMs);
    const correct = hit ? Number(hit.rate) : LEGACY_RATE;
    if (ratesClose(currentRate, correct)) continue;
    batch.update(d.ref, { bonusRate: correct, updatedAt: now });
    ops += 1;
    updated += 1;
    console.log("fix", d.id, new Date(dateMs).toLocaleDateString("th-TH"), currentRate, "→", correct);
    if (ops >= 400) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops) await batch.commit();

  console.log(`Done. scanned=${otSnap.size} updated=${updated}`);

  const afterSnap = await db.collection("otEntries").get();
  const summary = summarize("AFTER repair", afterSnap.docs, entries);
  if (summary.beforeBad > 0 || summary.afterBad > 0) {
    throw new Error(
      `VERIFY FAIL: still have bad rates beforeBad=${summary.beforeBad} afterBad=${summary.afterBad}`,
    );
  }
  console.log("VERIFY OK: all otEntries match schedule by shift date (0.6 before 17 Jul)");
}

main().catch((err) => {
  console.error("repair-ot-bonus-rates failed:", err.message || err);
  process.exit(1);
});
