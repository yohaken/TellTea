/**
 * ทำย้อนหลัง: อ่านบิลใหม่ด้วยระบบปัจจุบัน → ตั้งชื่อรายการ + ประเภทตามบิล (แบบบันทึกใหม่)
 * ไม่แตะยอดเงิน / VAT — ข้ามแถวที่ยอดหรือ VAT จากบิลไม่ตรงบัญชี (ให้คนดูเอง)
 * ข้าม: จัดเอง (owner) · เงินเดือน · เดือนที่ยื่น VAT แล้ว · แถวที่เคยทำไปแล้ว
 * เขียน ledgerAudit (ค่าเดิมครบ ย้อนกลับได้)
 *
 *   node scripts/live-apply-bill-rename.mjs --month=2026-09 --limit=10            # ดูอย่างเดียว
 *   node scripts/live-apply-bill-rename.mjs --month=2026-09 --limit=10 --apply    # บันทึก
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "functions/package.json"));
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp({ credential: applicationDefault(), projectId: "mypeer-501909" });
const { classifyLedgerType } = require("./classify-ledger.js");
const { extractOwnerBookFromReceipt } = require("./extract-owner-book.js");
const jiti = createJiti(import.meta.url);
const { billFieldValue, billTypeHintFromExtract, isBillNameSource, usableBillTypeHint } = await jiti.import(
  join(root, "src/lib/ledger-ai.ts"),
);

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] || d;
const month = arg("month", "2026-09");
const limit = Math.max(1, Math.min(30, Number(arg("limit", "10"))));
const apply = process.argv.includes("--apply");
const AUDIT_ACTION = "ai_rename_from_bill";

const bkkMonth = (ms) => {
  const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit" })
    .format(new Date(ms))
    .slice(0, 7);
  const y = Number(key.slice(0, 4));
  return y > 2400 ? `${y - 543}${key.slice(4)}` : key;
};
const toMs = (v) => (typeof v === "number" ? v : v?.toMillis?.() ?? Date.parse(v) ?? 0);
const bkkDay = (ms) =>
  new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short" }).format(new Date(ms));
const LABEL = { cogs: "ต้นทุน", sga: "ค่าใช้จ่าย", asset: "สินทรัพย์", "อื่นๆ": "อื่นๆ" };
const lab = (t) => LABEL[t] || t || "-";
const near = (a, b) => Math.abs(Number(a || 0) - Number(b || 0)) < 0.01;

const db = getFirestore();
const filed = await db.doc(`vatMonthlyReturns/${month}`).get();
if (filed.exists && filed.data()?.status === "filed") {
  console.log(`เดือน ${month} ยื่น VAT แล้ว — ไม่ทำ (ต้องให้เจ้าของยืนยันในหน้าบัญชี)`);
  process.exit(1);
}

const doneIds = new Set();
const prev = await db.collection("ledgerAudit").where("action", "==", AUDIT_ACTION).get();
for (const d of prev.docs) for (const it of d.data().items || []) doneIds.add(it.id);

const snap = await db.collection("ledger").orderBy("date", "desc").limit(1500).get();
const pool = [];
for (const doc of snap.docs) {
  const d = doc.data();
  const urls = (Array.isArray(d.receiptUrls) ? d.receiptUrls : [d.receiptUrl])
    .map((u) => String(u || "").trim())
    .filter(Boolean);
  if (!(Number(d.amountOut) > 0) || !urls.length) continue;
  if (d.typeSource === "owner" || String(d.typeSource || "").startsWith("payroll")) continue;
  if (doneIds.has(doc.id)) continue;
  if (bkkMonth(toMs(d.date)) !== month) continue;
  pool.push({ id: doc.id, ...d, urls });
}

console.log(`${apply ? "บันทึกจริง" : "ดูอย่างเดียว"} · เดือน ${month} · แถวที่ทำได้ ${pool.length} · เป้า ${limit}\n`);
const items = [];
const skipped = [];
for (const row of pool) {
  if (items.length >= limit) break;
  let res;
  try {
    res = await extractOwnerBookFromReceipt.run({ imageRefs: row.urls.slice(0, 4) }, { auth: { uid: "backfill" } });
  } catch (err) {
    skipped.push(`«${row.description}» อ่านบิลไม่สำเร็จ: ${err?.message || err}`);
    continue;
  }
  if (res.amountOut == null || !near(res.amountOut, row.amountOut)) {
    skipped.push(`«${row.description}» ยอดบิล ${res.amountOut} ≠ บัญชี ${row.amountOut}`);
    continue;
  }
  if (!near(res.vatInput, row.vatInput)) {
    skipped.push(`«${row.description}» VAT บิล ${res.vatInput ?? 0} ≠ บัญชี ${row.vatInput || 0}`);
    continue;
  }
  if (!isBillNameSource(res)) {
    skipped.push(`«${row.description}» ไม่ใช่ใบเสร็จ/ใบกำกับ (${res.docKind}${res.slipOnly ? " สลิป" : ""}) — คงชื่อเดิม`);
    continue;
  }
  const newDesc = billFieldValue("", res.description, { typedByUser: false });
  if (!newDesc) {
    skipped.push(`«${row.description}» บิลไม่มีชื่อ`);
    continue;
  }
  let hint = usableBillTypeHint(billTypeHintFromExtract(res, newDesc), newDesc);
  if (!hint) {
    const c = await classifyLedgerType.run({ description: newDesc }, { auth: { uid: "backfill" } });
    hint = { type: c.type, reason: c.reason, description: newDesc };
  }
  const item = {
    id: row.id,
    date: toMs(row.date),
    monthKey: month,
    beforeDescription: String(row.description || ""),
    afterDescription: newDesc,
    beforeType: String(row.type || ""),
    beforeSource: String(row.typeSource || ""),
    beforeReason: String(row.typeAiReason || ""),
    afterType: hint.type,
    afterSource: "ai",
    afterReason: hint.reason,
    amountOut: Number(row.amountOut),
    vatInput: Number(row.vatInput || 0),
  };
  items.push(item);
  console.log(
    `${items.length}. ${bkkDay(item.date)} ${item.amountOut.toLocaleString()} บาท · VAT ${item.vatInput || "-"} (ตรงบิล)\n` +
      `   ชื่อ   «${item.beforeDescription}» → «${item.afterDescription}»\n` +
      `   ประเภท ${lab(item.beforeType)} (${item.beforeSource || "-"}) → ${lab(item.afterType)} (ai) · ${item.afterReason}`,
  );
}

if (skipped.length) console.log(`\nข้าม ${skipped.length}:\n  ${skipped.join("\n  ")}`);

if (apply && items.length) {
  const now = Date.now();
  const batch = db.batch();
  for (const it of items) {
    batch.update(db.doc(`ledger/${it.id}`), {
      description: it.afterDescription,
      type: it.afterType,
      typeSource: "ai",
      typeAiReason: it.afterReason,
      typeUpdatedAt: now,
      updatedAt: now,
    });
  }
  batch.set(db.collection("ledgerAudit").doc(), {
    action: AUDIT_ACTION,
    actor: "agent-backfill",
    createdAt: now,
    closedMonthOverride: false,
    closedMonths: [],
    summary: `ตั้งชื่อ+ประเภทจากบิล ${items.length} รายการ (${month})`,
    items,
  });
  await batch.commit();

  let ok = 0;
  for (const it of items) {
    const d = (await db.doc(`ledger/${it.id}`).get()).data();
    const good =
      d.description === it.afterDescription &&
      d.type === it.afterType &&
      d.typeSource === "ai" &&
      near(d.amountOut, it.amountOut) &&
      near(d.vatInput, it.vatInput);
    if (good) ok += 1;
    else console.log(`ตรวจไม่ผ่าน ${it.id}`, JSON.stringify({ description: d.description, type: d.type, amountOut: d.amountOut, vatInput: d.vatInput }));
  }
  console.log(`\nบันทึกแล้ว ${items.length} · ตรวจซ้ำจากฐานข้อมูลผ่าน ${ok}/${items.length} (ยอด/VAT ไม่เปลี่ยน)`);
} else {
  console.log(`\nจะเปลี่ยน ${items.length} รายการ — ${apply ? "ไม่มีอะไรให้บันทึก" : "ยังไม่ได้บันทึก (ใส่ --apply)"}`);
}
