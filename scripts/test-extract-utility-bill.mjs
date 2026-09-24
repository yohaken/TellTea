/**
 * Wiring: extract-owner-book treats ใบแจ้งค่าไฟ as utility_bill (amount due, not prior receipt).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "functions/extract-owner-book.js"), "utf8");

assert.match(src, /utility_bill/);
assert.match(src, /ยอดเรียกเก็บ/);
assert.match(src, /จำนวนเงินที่ต้องชำระ/);
assert.match(src, /รวมเงินที่ต้องชำระทั้งสิ้น/);
assert.match(src, /UTILITY_AMOUNT_RETRY_SYSTEM_PROMPT/);
assert.match(src, /utility amount retry skip/);
assert.match(src, /ห้ามใช้ยอดจากส่วน "ใบเสร็จรับเงิน"/);
assert.match(src, /docKind !== "utility_bill"/);
assert.match(src, /ใบแจ้งค่าสาธารณูปโภค/);
assert.match(src, /\^\(ค่าไฟ\|ค่าน้ำ\|ค่าเน็ต\|ค่าโทรศัพท์\)\$/);

const panel = readFileSync(
  join(root, "src/components/BillNoticeLedgerPanel.tsx"),
  "utf8",
);
assert.match(panel, /ค่าไฟ = ยอดเรียกเก็บ|ค่าไฟใช้ยอดเรียกเก็บ/);

console.log("ok: extract-owner-book utility bill amount rules");
