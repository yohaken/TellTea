/**
 * Guard: ledger billLines · AI extract · confirm stock cost
 * + import unmatched names → stock (no auto cost)
 * + timing safety: bill-line AI must not block ledger save busy
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const types = read("src/lib/types.ts");
assert.match(types, /export type LedgerBillLine/);
assert.match(types, /billLines\?: LedgerBillLine\[\]/);

const billLinesLib = read("src/lib/ledger-bill-lines.ts");
assert.match(billLinesLib, /extractBillLinesFromPhotos/);
assert.match(billLinesLib, /applyLedgerBillLineToStock/);
assert.match(billLinesLib, /rematchBillLinesToStock/);
assert.match(billLinesLib, /normalizeLedgerBillLines/);
assert.match(billLinesLib, /importUnmatchedBillLinesToStock/);
assert.match(billLinesLib, /syncCogsBillLinesIntoStock/);
assert.match(billLinesLib, /suggestStockCatalogNameFromBillLine/);
assert.match(billLinesLib, /isLikelyPackagingBillLine/);
assert.match(billLinesLib, /classifyBillLineForCatalog/);
assert.match(billLinesLib, /BILL_LINE_INGREDIENT_CONFIDENCE/);
assert.match(billLinesLib, /includeUncertain/);
assert.match(billLinesLib, /ledgerType/);
assert.match(billLinesLib, /canonicalLedgerType/);
assert.match(billLinesLib, /ประเภทบช\.|ประเภทต้นทุน|cogs/);
assert.match(billLinesLib, /includeInCount:\s*false/);
assert.match(billLinesLib, /createStockItem/);
assert.match(billLinesLib, /แถบ«ไม่นับ»|แถบ «ไม่นับ»|\/stock\//);
assert.doesNotMatch(
  billLinesLib,
  /importUnmatchedBillLinesToStock[\s\S]{0,800}setStockUnitCost/,
);
assert.doesNotMatch(
  billLinesLib,
  /importUnmatchedBillLinesToStock[\s\S]{0,900}unitCost:\s*[1-9]/,
);

const ledger = read("src/lib/ledger.ts");
assert.match(ledger, /normalizeLedgerBillLines/);
assert.match(ledger, /billLines/);

const panel = read("src/components/LedgerBillLinesPanel.tsx");
assert.match(panel, /รายการในบิล/);
assert.match(panel, /ยืนยันอัปเดตต้นทุน/);
assert.match(panel, /อัปเดต\s*</);
assert.match(panel, /ยืนยัน/);
assert.match(panel, /บันทึกก่อน/);
assert.match(panel, /ledgerEntryId \?/);
assert.match(panel, /applyLedgerBillLineToStock/);
assert.match(panel, /importUnmatchedBillLinesToStock/);
assert.match(panel, /rematchBillLinesToStock/);
assert.match(panel, /เข้าคลัง/);
assert.match(panel, /classifyBillLineForCatalog/);
assert.match(panel, /มั่นใจ|ไม่มั่นใจ/);
assert.match(panel, /includeUncertain/);
assert.match(panel, /ledgerType/);
assert.match(panel, /isCogs|ประเภทต้นทุน/);
assert.match(panel, /PackagePlus/);
assert.match(panel, /ยังไม่ใส่ต้นทุน/);
assert.match(panel, /formBusy/);
assert.match(panel, /setExtracting/);
assert.match(panel, /extractGenRef/);
assert.match(panel, /setExtracting\(true\)/);
assert.doesNotMatch(
  panel,
  /async function runExtract\(\)[\s\S]{0,200}setFormBusy\(true\)/,
);
assert.match(
  panel,
  /บันทึกบัญชีได้ตามปกติ|ไม่ต้องรอ|ไม่บล็อก/,
);

const css = read("src/app/globals.css");
assert.match(css, /\.ledger-bill-lines-sheet\s*\{[^}]*max-height/);
assert.match(css, /\.ledger-bill-lines-bar-acts/);
assert.match(css, /\.modal-backdrop\.edit-modal \.entry-actions \{\s*z-index: 3/);

const addOut = read("src/components/LedgerAddOutModal.tsx");
assert.match(addOut, /LedgerBillLinesPanel/);
assert.match(addOut, /billLines/);
assert.match(addOut, /extractBillLinesFromPhotos/);
assert.match(addOut, /billLinesGenRef/);
assert.match(addOut, /formBusy=\{busy\}/);
assert.match(addOut, /void extractBillLinesFromPhotos/);
assert.match(addOut, /\.catch\(\(\) => undefined\)/);
assert.match(addOut, /LedgerTypeField[\s\S]*LedgerBillLinesPanel[\s\S]*entry-actions/);
assert.match(addOut, /ledgerType=\{/);
assert.match(addOut, /syncCogsBillLinesIntoStock/);
assert.match(addOut, /\/stock\//);

const ledgerPage = read("src/app/ledger/page.tsx");
assert.match(ledgerPage, /LedgerBillLinesPanel/);
assert.match(ledgerPage, /billLines/);
assert.match(ledgerPage, /billLinesGenRef/);
assert.match(ledgerPage, /formBusy=\{busy\}/);
assert.match(ledgerPage, /void runExtractBillLines/);
assert.match(ledgerPage, /LedgerTypeField[\s\S]*LedgerBillLinesPanel[\s\S]*entry-actions/);
assert.match(ledgerPage, /ledgerType=\{/);
assert.match(ledgerPage, /syncCogsBillLinesIntoStock/);
assert.match(ledgerPage, /\/stock\//);

const fn = read("functions/menu-sop-ai.js");
assert.match(fn, /extractStockCostsFromBill/);
assert.match(fn, /requireAuth\(context\)/);
assert.match(fn, /analyzeMenuSopCost[\s\S]*requireAuth\(context\)/);
assert.match(fn, /confidence = ความมั่นใจว่าเป็นวัตถุดิบ|≥0\.7/);
assert.doesNotMatch(fn, /analyzeMenuSopCost[\s\S]{0,200}requireOwner/);

// normalize smoke
function normalizeLedgerBillLines(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const name = String(row.name || "").trim();
    if (!name) continue;
    out.push({ name });
  }
  return out;
}
assert.deepEqual(normalizeLedgerBillLines(null), []);
assert.deepEqual(normalizeLedgerBillLines([{ name: "แป้ง" }, { name: "" }]).map((x) => x.name), [
  "แป้ง",
]);

// catalog name + packaging guards (mirror lib)
function suggestStockCatalogNameFromBillLine(billName) {
  let s = String(billName || "").trim();
  if (!s) return "";
  s = s.split(/\s*[×xX]\s*\d+/)[0] || s;
  s = s.replace(
    /\d[\d,]*\s*(กรัม|ก\.|กก\.?|กิโลกรัม|มล\.?|ลิตร|ล\.|ซม|มิล|ชิ้น|ใบ|เส้น|ฝา|ม้วน|กระป๋อง|ถุง|ขวด).*$/i,
    "",
  );
  s = s.replace(/\d[\d,]*\s*$/, "").replace(/\s+/g, " ").trim();
  return (s || billName).trim().slice(0, 80);
}
const PACKAGING_HINT =
  /ถุง|หลอด|แก้ว|ฝา|ฟิล์ม|กระดาษ|โคนไอศ|แก๊ซ|ถ้วยท็อป|ม้วนฝา/i;
const NON_INGREDIENT_FEE_HINT =
  /ค่าบริการ|ค่าขนส่ง|ค่าจัดส่ง|ค่าส่งของ|ค่าส่งสินค้า|ค่าธรรมเนียม|ค่าโอน|shipping|freight|delivery\s*fee|service\s*fee|^ภาษี|ภาษีมูลค่า|vat\s*\d|ส่วนลด|discount|มัดจำ|deposit|ค่าแรง|ค่าจ้าง|ค่าเช่า|ค่าไฟ|ค่าน้ำ(?!แข็ง)|ค่าแก๊ส|ค่าอินเทอร์เน็ต|ค่าโทร|ค่าขยะ|ค่าที่จอด/i;
function isLikelyPackagingBillLine(name) {
  return PACKAGING_HINT.test(String(name || ""));
}
function isLikelyNonIngredientFeeBillLine(name) {
  return NON_INGREDIENT_FEE_HINT.test(String(name || "").trim());
}
assert.equal(suggestStockCatalogNameFromBillLine("แป้งสาลี 1 กก."), "แป้งสาลี");
assert.equal(suggestStockCatalogNameFromBillLine("น้ำตาล × 50"), "น้ำตาล");
assert.ok(isLikelyPackagingBillLine("ถุงพลาสติก เล็ก"));
assert.ok(!isLikelyPackagingBillLine("แป้งสาลี"));
assert.ok(isLikelyNonIngredientFeeBillLine("ค่าบริการโกดังไทย"));
assert.ok(isLikelyNonIngredientFeeBillLine("ค่าขนส่งสินค้าทางเรือ ล็อต 1"));
assert.ok(!isLikelyNonIngredientFeeBillLine("ค่าน้ำแข็ง"));

function canonicalLedgerType(raw) {
  const t = String(raw || "").trim().toLowerCase();
  if (t === "cogs" || t === "ต้นทุน" || t === "ต้นทุน (cogs)") return "cogs";
  return t;
}
function classifyBillLineForCatalog(line, opts) {
  const name = String(line.name || "").trim();
  if (!name) return "skip";
  if (isLikelyPackagingBillLine(name)) return "skip";
  if (isLikelyNonIngredientFeeBillLine(name)) return "skip";
  const note = String(line.note || "");
  if (/บรรจุ|ไม่ใช่วัตถุดิบ|ข้าม|สลิป|โอนเงิน|ค่าบริการ|ค่าขนส่ง/i.test(note))
    return "skip";
  if (canonicalLedgerType(opts?.ledgerType) === "cogs") return "ingredient";
  const conf = Number(line.confidence);
  if (Number.isFinite(conf) && conf >= 0.7) return "ingredient";
  return "uncertain";
}
assert.equal(classifyBillLineForCatalog({ name: "นมเมจิ", confidence: 0.9 }), "ingredient");
assert.equal(classifyBillLineForCatalog({ name: "ของแถม?", confidence: 0.4 }), "uncertain");
assert.equal(classifyBillLineForCatalog({ name: "ถุงพลาสติก", confidence: 0.9 }), "skip");
assert.equal(classifyBillLineForCatalog({ name: "นม", confidence: 0.9, note: "บรรจุ" }), "skip");
assert.equal(
  classifyBillLineForCatalog({ name: "ของแถม?", confidence: 0.3 }, { ledgerType: "cogs" }),
  "ingredient",
);
assert.equal(
  classifyBillLineForCatalog({ name: "ถุง", confidence: 0.9 }, { ledgerType: "cogs" }),
  "skip",
);
assert.equal(
  classifyBillLineForCatalog(
    { name: "ค่าบริการโกดังไทย", confidence: 0.95 },
    { ledgerType: "cogs" },
  ),
  "skip",
);
assert.equal(
  classifyBillLineForCatalog(
    { name: "ค่าขนส่งสินค้าทางเรือ", confidence: 0.9 },
    { ledgerType: "cogs" },
  ),
  "skip",
);
assert.equal(
  classifyBillLineForCatalog({ name: "นม", confidence: 0.3 }, { ledgerType: "sga" }),
  "uncertain",
);

assert.match(billLinesLib, /isLikelyNonIngredientFeeBillLine/);
assert.match(billLinesLib, /ค่าบริการ/);
assert.match(billLinesLib, /ค่าขนส่ง/);

const version = read("src/lib/version.ts");
assert.ok(Number(version.match(/APP_BUILD = (\d+)/)[1]) >= 1045);

console.log("OK test-ledger-bill-lines");
