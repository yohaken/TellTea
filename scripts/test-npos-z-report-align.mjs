/**
 * Gate: Z/X shift slip column alignment + pre-sign checklist.
 * Prevents bill-count gluing to money (e.g. 8 + 301 → "8301").
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 391/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 127/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+98/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.14\.75"/);

assert.ok(existsSync(join(root, "docs/npos-z-report-align-checklist.md")));
const doc = read("docs/npos-z-report-align-checklist.md");
assert.match(doc, /1\.14\.75/);
assert.match(doc, /tripleRow|table-layout/);
assert.match(doc, /ตรวจก่อนเซ็น/);

const builder = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/ShiftReportFormBuilder.java",
);
assert.match(builder, /padLeft/);
assert.match(builder, /midW/);
assert.match(builder, /rightW/);
assert.match(builder, /ตรวจก่อนเซ็น \/ ส่งเงิน/);
assert.match(builder, /นับรวมเงินทอนเริ่มต้นแล้ว/);
assert.match(builder, /ยอดที่ต้องนำส่งตรงกับเงินในมือ/);
assert.match(builder, /โอน\/PromptPay ตรวจสลิปแล้ว/);
assert.match(builder, /ส่วนต่างมีเหตุผล/);
// old glue pattern must be gone
assert.doesNotMatch(
  builder,
  /tail = \(mid == null \? "" : mid\) \+ " " \+ \(right == null \? "" : right\)/,
);

const web = read("src/lib/pos-printer/shift-snapshot-template.ts");
assert.match(web, /table-layout:\s*fixed/);
assert.match(web, /tabular-nums/);
assert.match(web, /nth-child\(2\)/);
assert.match(web, /ตรวจก่อนเซ็น \/ ส่งเงิน/);
assert.match(web, /นับรวมเงินทอนเริ่มต้นแล้ว/);
assert.match(web, /ยอดที่ต้องนำส่งตรงกับเงินในมือ/);

/** Mirror native tripleRow spacing for a smoke numeric case. */
function tripleRow(left, mid, right, width = 42) {
  let l = left ?? "";
  let m = String(mid ?? "");
  let r = String(right ?? "");
  let midW = Math.max(4, Math.min(6, Math.floor(width / 8)));
  let rightW = Math.max(8, Math.min(12, Math.floor(width / 3)));
  const gap = 2;
  let rightBlock = midW + gap + rightW;
  if (rightBlock >= width - 4) {
    midW = 4;
    rightW = Math.max(6, Math.floor(width / 4));
    rightBlock = midW + gap + rightW;
  }
  const leftW = Math.max(4, width - rightBlock);
  if (l.length > leftW) l = `${l.slice(0, Math.max(1, leftW - 1))}…`;
  if (m.length > midW) m = m.slice(-midW);
  if (r.length > rightW) r = r.slice(-rightW);
  const padLeft = (s, w) => s.padStart(w, " ");
  return `${l}${" ".repeat(leftW - l.length)}${padLeft(m, midW)}${" ".repeat(gap)}${padLeft(r, rightW)}`;
}

const cashRow = tripleRow("เงินสด", "8", "301", 42);
assert.equal(cashRow.length, 42);
assert.match(cashRow, /เงินสด/);
assert.match(cashRow, /\s{2,}8\s{2,}301/);
assert.doesNotMatch(cashRow, /8301|8 301$/);
assert.ok(!cashRow.includes("8 301") || /\s{2,}8\s{2,}301/.test(cashRow));
// ensure at least two spaces between 8 and 301
const idx8 = cashRow.lastIndexOf("8");
const idx301 = cashRow.indexOf("301");
assert.ok(idx8 >= 0 && idx301 > idx8);
assert.ok(idx301 - idx8 >= 3, `gap too small in "${cashRow}"`);

const remaining = read("docs/npos-remaining-checklist.md");
assert.match(remaining, /npos-z-report-align-checklist/);

const check = read("scripts/check-npos-shop.mjs");
assert.match(check, /z-report-align/);

console.log("OK test-npos-z-report-align");
