/**
 * floorMoney ปัดลงสตางค์ — ไม่ทำยอดหาย 1 สตางค์จากเศษ float (8604.80 → 8604.79)
 * เดือนปิดงบที่เซฟก่อนแก้ (floorVersion < 2) ยังใช้สูตรเดิมให้ตรงกับที่ยื่น
 * npx tsx scripts/test-vat-floor-money.ts
 */
import assert from "node:assert/strict";
import { floorMoney, VAT_FLOOR_VERSION } from "../src/lib/vat-monthly";
import { deriveMonthBooksView, emptyMonthBooksDraft } from "../src/lib/vat-month-books";

for (const v of [8604.8, 0.29, 9.95, 1004.99, 1234.57, 0.01, 100]) {
  assert.equal(floorMoney(v), v, `floorMoney(${v}) must not lose a satang`);
}
assert.equal(floorMoney(10.999), 10.99);
assert.equal(floorMoney(10.991), 10.99);
assert.equal(floorMoney(0), 0);
assert.equal(floorMoney(-5), 0);
assert.equal(floorMoney(Number.NaN), 0);

assert.equal(floorMoney(8604.8, true), 8604.79, "legacy formula kept for filed months");
assert.equal(floorMoney(0.29, true), 0.28);

const base = { ...emptyMonthBooksDraft("2026-09"), ingredientVat: 8604.8 };

const open = deriveMonthBooksView({ ...base, status: "saved" });
assert.equal(open.inputBooksVat, 8604.8, "open month deducts the full amount");

const filedOld = deriveMonthBooksView({ ...base, status: "filed" });
assert.equal(filedOld.inputBooksVat, 8604.79, "filed before fix keeps filed number");

const filedOldV1 = deriveMonthBooksView({ ...base, status: "filed", floorVersion: 1 });
assert.equal(filedOldV1.inputBooksVat, 8604.79);

const filedNew = deriveMonthBooksView({ ...base, status: "filed", floorVersion: VAT_FLOOR_VERSION });
assert.equal(filedNew.inputBooksVat, 8604.8, "filed after fix uses corrected rounding");

console.log("OK test-vat-floor-money");
