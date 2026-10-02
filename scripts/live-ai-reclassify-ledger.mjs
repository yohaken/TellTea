/**
 * ให้ AI (ฟังก์ชันตัวในเครื่อง) จัดประเภทแถวบัญชีจริง N แถว — แบบเดียวกับปุ่ม «AI จัด»
 * เลือกเฉพาะเงินออกที่ผู้จัด = เดา/ว่าง · ข้ามจัดเอง/เงินเดือน · ข้ามเดือนที่ยื่น VAT แล้ว
 *
 *   node scripts/live-ai-reclassify-ledger.mjs            # ดูอย่างเดียว
 *   node scripts/live-ai-reclassify-ledger.mjs --apply    # บันทึก + ledgerAudit
 *   --limit=5
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "functions/package.json"));
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp({ credential: applicationDefault(), projectId: "mypeer-501909" });
const { classifyLedgerType } = require("./classify-ledger.js");
const db = getFirestore();

const apply = process.argv.includes("--apply");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const limit = Math.max(1, Math.min(50, Number(limitArg?.split("=")[1]) || 5));

/** แถวเก่าบางแถวเก็บปี พ.ศ. เป็น ค.ศ. (2569) — แปลงกลับก่อนเช็กงวด VAT */
const bkkMonth = (ms) => {
  const key = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date(ms))
    .slice(0, 7);
  const y = Number(key.slice(0, 4));
  return y > 2400 ? `${y - 543}${key.slice(4)}` : key;
};
const toMs = (v) => (typeof v === "number" ? v : v?.toMillis?.() ?? Date.parse(v) ?? 0);

const filedCache = new Map();
async function isFiled(monthKey) {
  if (!filedCache.has(monthKey)) {
    const snap = await db.doc(`vatMonthlyReturns/${monthKey}`).get();
    filedCache.set(monthKey, snap.exists && snap.data()?.status === "filed");
  }
  return filedCache.get(monthKey);
}

const snap = await db.collection("ledger").orderBy("date", "desc").limit(600).get();
const picked = [];
const seenDesc = new Set();
for (const d of snap.docs) {
  if (picked.length >= limit) break;
  const r = d.data();
  const src = String(r.typeSource || "").trim().toLowerCase();
  const desc = String(r.description || "")
    .normalize("NFC")
    .replace(/[\s\u200b-\u200d\ufeff]/g, "");
  if (!(Number(r.amountOut) > 0) || !desc || seenDesc.has(desc)) continue;
  if (src === "owner" || src === "ai" || src.startsWith("payroll")) continue;
  const month = bkkMonth(toMs(r.date));
  if (await isFiled(month)) continue;
  seenDesc.add(desc);
  picked.push({ id: d.id, month, ...r });
}

console.log(`${apply ? "APPLY" : "DRY-RUN"} · ${picked.length} แถว\n`);
const items = [];
for (const r of picked) {
  try {
    const res = await classifyLedgerType.run({ description: r.description }, { auth: { uid: "owner-script" } });
    const before = `${r.type || "—"} (${r.typeSource || "ว่าง"})`;
    console.log(`${r.month} · ${r.description} · ฿${r.amountOut}\n   ${before} → ${res.type} (ai) · ${res.reason}`);
    if (apply) {
      const now = Date.now();
      await db.doc(`ledger/${r.id}`).update({
        type: res.type,
        typeSource: "ai",
        typeAiReason: res.reason,
        typeUpdatedAt: now,
        updatedAt: now,
      });
      items.push({
        id: r.id,
        monthKey: r.month,
        beforeType: r.type || "",
        beforeSource: String(r.typeSource || ""),
        afterType: res.type,
        afterSource: "ai",
      });
    }
  } catch (err) {
    console.log(`FAIL ${r.description} → ${err?.message || err}`);
  }
}

if (apply && items.length) {
  await db.collection("ledgerAudit").add({
    action: "ai_reclassify",
    summary: `AI จัด ${items.length} รายการ (สคริปต์ทดสอบ)`,
    count: items.length,
    monthKeys: [...new Set(items.map((i) => i.monthKey))].sort(),
    items,
    closedMonthOverride: false,
    closedMonths: [],
    actor: "owner-script",
    at: Date.now(),
  });
  console.log(`\nบันทึกแล้ว ${items.length} แถว + ledgerAudit`);
}
process.exit(0);
