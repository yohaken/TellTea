/**
 * Tests: LINE MAN monthly report parser
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  linemanMonthlyToImportRows,
  looksLikeLinemanMonthlyReport,
  parseLinemanMonthlyReport,
} from "../src/lib/vat-import-lineman-monthly";
import { gpVatFromFee } from "../src/lib/personal-income-tax";

const fixture = readFileSync(
  join(__dirname, "../testdata/vat-import/lineman-monthly-2026-06.txt"),
  "utf8",
);

assert.equal(looksLikeLinemanMonthlyReport(fixture), true);
assert.equal(looksLikeLinemanMonthlyReport("hello"), false);

const parsed = parseLinemanMonthlyReport(fixture);
assert.equal(parsed.monthKey, "2026-06");
assert.ok(parsed.storeLabel.includes("TELL TEA"));
assert.equal(parsed.monthGross, 42_504);
assert.equal(parsed.monthFeeInclVat, 13_643.97);
assert.equal(parsed.monthTransferOut, 28_860.03);
assert.equal(parsed.days.length, 30);

const d1 = parsed.days.find((d) => d.dateKey === "2026-06-01");
assert.ok(d1);
assert.equal(d1.grossInclusive, 1_578);
assert.equal(d1.feeInclVat, 506.55);
assert.equal(d1.systemBalance, 1_071.45);
assert.equal(d1.gpVat, gpVatFromFee(506.55, "incVat", 7));

// วันยอดโอนธนาคารเป็น 0 แต่ยังมียอดเงินในระบบ
const d21 = parsed.days.find((d) => d.dateKey === "2026-06-21");
assert.ok(d21);
assert.equal(d21.bankTransferOut, 0);
assert.equal(d21.systemBalance, 477.34);

const rows = linemanMonthlyToImportRows(parsed, {
  fileName: "รายงานประจำเดือน มิถุนายน 2569.pdf",
});
assert.equal(rows.length, 30);
assert.equal(rows[0]?.channel, "lineman");
assert.equal(rows[0]?.adapterId, "lineman-monthly-pdf");
assert.equal(rows[0]?.externalId, "lm-day:2026-06-01");
assert.equal(rows[0]?.netTransfer, 1_071.45);
assert.equal(rows[0]?.fee, 506.55);

assert.equal(parsed.warnings.length, 0);

console.log("test-vat-import-lineman-monthly: ok");
