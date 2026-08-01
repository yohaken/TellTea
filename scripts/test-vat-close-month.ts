import assert from "node:assert/strict";
import {
  defaultVatCloseMonthKey,
  isVatCloseWindow,
} from "../src/lib/vat-monthly";

// 1 ส.ค. 2026 Bangkok ≈ 2026-07-31 17:00 UTC
const aug1Bangkok = Date.parse("2026-07-31T17:00:00.000Z");
assert.equal(defaultVatCloseMonthKey(aug1Bangkok), "2026-07");
assert.equal(isVatCloseWindow(aug1Bangkok), true);

// 16 ส.ค. 2026 Bangkok
const aug16Bangkok = Date.parse("2026-08-15T17:00:00.000Z");
assert.equal(defaultVatCloseMonthKey(aug16Bangkok), "2026-08");
assert.equal(isVatCloseWindow(aug16Bangkok), false);

// 1 ก.ค. → เดือนปิด = มิ.ย.
const jul1Bangkok = Date.parse("2026-06-30T17:00:00.000Z");
assert.equal(defaultVatCloseMonthKey(jul1Bangkok), "2026-06");

console.log("ok vat-close-month · default Jul when early Aug");
