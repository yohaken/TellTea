/**
 * ประเภทจากการอ่านบิล → ใช้แทนการเรียก AI จัดประเภทซ้ำตอนบันทึก (ประหยัด 1 call)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url);
const { billTypeHintFromExtract, usableBillTypeHint, billFieldValue, isBillNameSource } = await jiti.import(
  join(root, "src/lib/ledger-ai.ts"),
);

// บิลเป็นค่าเริ่มต้น — ยกเว้นพิมพ์เอง
const auto = { typedByUser: false };
const typed = { typedByUser: true };
assert.equal(billFieldValue("", "ท็อปเวิลด์", auto), "ท็อปเวิลด์");
assert.equal(billFieldValue("", "ท็อปเวิลด์", typed), "ท็อปเวิลด์", "typed then cleared → fill");
assert.equal(billFieldValue("โอนเงินให้ นาง ก", "ท็อปเวิลด์", auto), "ท็อปเวิลด์", "re-read refreshes AI value");
assert.equal(billFieldValue("ของร้าน", "ท็อปเวิลด์", typed), "ของร้าน", "never overwrite typed");
assert.equal(billFieldValue("ของร้าน", "", auto), "ของร้าน", "empty bill keeps current");
assert.equal(billFieldValue("ของร้าน", null, auto), "ของร้าน");
assert.equal(billFieldValue("", 2265, auto), "2265");
assert.equal(billFieldValue("3780", 2265, auto), "2265");
assert.equal(billFieldValue("100", 2265, typed), "100");
assert.equal(billFieldValue("ชื่อเดิม", "ใหม่", { typedByUser: false, onlyIfEmpty: true }), "ชื่อเดิม");
assert.equal(billFieldValue("", "ใหม่", { typedByUser: false, onlyIfEmpty: true }), "ใหม่");

// สลิป/รูปสินค้า (ไม่ใช่ใบเสร็จ) → ไม่ทับชื่อที่มีอยู่ · ช่องว่างยังเติมให้
assert.equal(billFieldValue("มัน5ถุง 45กก.", "กล้วยน้ำว้าดิบ 5 ถุงใหญ่", { typedByUser: false, onlyIfEmpty: true }), "มัน5ถุง 45กก.");
assert.equal(billFieldValue("", "กล้วยน้ำว้าดิบ", { typedByUser: false, onlyIfEmpty: true }), "กล้วยน้ำว้าดิบ");
const srcOf = (p) => readFileSync(join(root, p), "utf8");
assert.match(srcOf("src/components/LedgerAddOutModal.tsx"), /onlyIfEmpty: !isBillNameSource\(result\)/);
assert.match(srcOf("src/app/owner-books/page.tsx"), /onlyIfEmpty: onlyIfEmpty \|\| !isBillNameSource\(result\)/);
assert.equal(isBillNameSource({ docKind: "tax_invoice", slipOnly: false, goodsOnly: false }), true);
assert.equal(isBillNameSource({ docKind: "utility_bill", slipOnly: false, goodsOnly: false }), true);
assert.equal(isBillNameSource({ docKind: "bank_slip", slipOnly: true, goodsOnly: false }), false, "slip + goods photo (มัน→กล้วย)");
assert.equal(isBillNameSource({ docKind: "other", slipOnly: false, goodsOnly: true }), false);
assert.equal(isBillNameSource({ docKind: "other", slipOnly: false, goodsOnly: false }), false);

// ลำดับจริง: แนบสลิปก่อน → เพิ่มใบกำกับ (ผล merge ใหม่) → ชื่อ/ประเภทตามบิลล่าสุด
let desc = "";
const slip = { description: "โอนเงินให้ นาง ก", type: "อื่นๆ", reason: "สลิป", docKind: "bank_slip", slipOnly: true };
desc = billFieldValue(desc, slip.description, auto);
assert.equal(billTypeHintFromExtract(slip, desc), null, "slip → classify from name on save");
const merged = { description: "ท็อปเวิลด์", type: "cogs", reason: "วัตถุดิบ", docKind: "tax_invoice", slipOnly: false };
desc = billFieldValue(desc, merged.description, auto);
assert.equal(desc, "ท็อปเวิลด์");
assert.equal(usableBillTypeHint(billTypeHintFromExtract(merged, desc), desc)?.type, "cogs");
// พิมพ์ชื่อเองก่อนแนบ → ชื่อคงเดิม ประเภทยังได้จากบิล
const own = billFieldValue("ค่าของเบเกอรี่", merged.description, typed);
assert.equal(own, "ค่าของเบเกอรี่");
assert.equal(usableBillTypeHint(billTypeHintFromExtract(merged, own), own)?.type, "cogs");

const bill = { type: "cogs", reason: "ซื้อวัตถุดิบ", docKind: "tax_invoice", slipOnly: false };

const hint = billTypeHintFromExtract(bill, " ท็อปเวิลด์ ");
assert.deepEqual(hint, { type: "cogs", reason: "ซื้อวัตถุดิบ", description: "ท็อปเวิลด์" });
assert.equal(billTypeHintFromExtract({ ...bill, docKind: "bank_slip", slipOnly: true }, "ชาไทย"), null);
assert.equal(billTypeHintFromExtract({ ...bill, docKind: "bank_slip" }, "ชาไทย"), null);
assert.equal(billTypeHintFromExtract({ ...bill, type: "อื่นๆ" }, "ของ"), null);
assert.equal(billTypeHintFromExtract(bill, "  "), null);
assert.equal(billTypeHintFromExtract({ ...bill, type: "sga", reason: "" }, "ค่าน้ำ").reason, "อ่านจากรูปใบเสร็จ");

assert.equal(usableBillTypeHint(hint, "ท็อปเวิลด์"), hint);
assert.equal(usableBillTypeHint(hint, "ท็อปเวิลด์ "), hint);
assert.equal(usableBillTypeHint(hint, "ท็อปเวิลด์ นม"), null);
assert.equal(usableBillTypeHint(null, "ท็อปเวิลด์"), null);

const read = (p) => readFileSync(join(root, p), "utf8");
for (const file of [
  "src/components/LedgerAddOutModal.tsx",
  "src/app/ledger/page.tsx",
  "src/app/owner-books/page.tsx",
]) {
  const src = read(file);
  assert.match(src, /billTypeHintFromExtract\(/, `${file}: bill read sets hint`);
  assert.match(src, /usableBillTypeHint\(aiTypeHintRef\.current, description\)/, `${file}: save reuses hint`);
  assert.match(src, /aiTypeHintRef\.current = \{ type: result\.type/, `${file}: AI preview reused on save`);
  assert.match(src, /aiTypeHintRef\.current = hint;/, `${file}: new read replaces old hint`);
}
for (const file of ["src/components/LedgerAddOutModal.tsx", "src/app/owner-books/page.tsx"]) {
  const src = read(file);
  assert.match(src, /billFieldValue\(descriptionRef\.current, result\.description/, `${file}: bill fills name`);
  assert.match(src, /descTypedRef\.current = true;\s*setDescription\(e\.target\.value\)/, `${file}: typing marks own name`);
}

const { createRequire } = await import("node:module");
const fnRequire = createRequire(join(root, "functions/package.json"));
const { extractJsonObject } = fnRequire("./classify-ledger.js");
assert.deepEqual(
  extractJsonObject('{"type":"cogs","reason":"a}b"}\nเอกสาร"}\n"}\nสลิป"}'),
  { type: "cogs", reason: "a}b" },
  "Gemini junk after complete JSON",
);
assert.equal(extractJsonObject('{"type":"cogs","vatInpu'), null);

const { _cleanBillDescription: cleanName } = fnRequire("./extract-owner-book.js");
assert.equal(cleanName("บิลเงินสด / ใบกำกับภาษี บริษัท ท็อปส์เวิลด์(2014) จำกัด"), "ท็อปส์เวิลด์");
assert.equal(cleanName("ใบส่งสินค้า แม็คโคร"), "แม็คโคร");
assert.equal(cleanName("ท็อปเวิลด์ แป้งสาลี นมข้นหวาน มิตรผลน้ำเชื่อม"), "ท็อปเวิลด์ แป้งสาลี นมข้นหวาน มิตรผลน้ำเชื่อม");
assert.equal(cleanName("ใบเสร็จรับเงิน"), "ใบเสร็จรับเงิน", "never blank the name");

const fn = read("functions/extract-owner-book.js");
assert.match(fn, /ท็อปเวิลด์ แป้งสาลี นมข้นหวาน มิตรผลน้ำเชื่อม/, "naming style example in prompt");
assert.match(fn, /maxOutputTokens: 4096/);
assert.match(fn, /class BadAnswerError/);

console.log("OK test-ledger-bill-type-hint");
