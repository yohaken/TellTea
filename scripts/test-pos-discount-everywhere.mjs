import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const paper = readFileSync(join(root, "src/components/PosReceiptPaper.tsx"), "utf8");
assert.match(paper, /receiptDiscountBaht/);
assert.match(paper, /ส่วนลด/);
assert.match(paper, /pos-receipt-paper-total-row--discount/);

const receiptView = readFileSync(join(root, "src/lib/pos-receipt-view.ts"), "utf8");
assert.match(receiptView, /export function receiptDiscountBaht/);

const local = readFileSync(join(root, "src/lib/pos-local-receipts.ts"), "utf8");
assert.match(local, /discountTotal/);
assert.match(local, /grossTotal/);

const shift = readFileSync(join(root, "src/components/PosShiftView.tsx"), "utf8");
assert.match(shift, /ยอดก่อนลด/);
assert.match(shift, /summary\.discountTotal/);

const types = readFileSync(join(root, "src/lib/types.ts"), "utf8");
assert.match(types, /discountBaht\?: number/);

const report = readFileSync(join(root, "src/lib/pos-sales-report.ts"), "utf8");
assert.match(report, /discountTotal/);
assert.match(report, /resolveSaleDiscountBaht/);

const reportUi = readFileSync(join(root, "src/components/PosSalesReport.tsx"), "utf8");
assert.match(reportUi, /ส่วนลด/);
assert.match(reportUi, /summary\.discountTotal/);

const version = readFileSync(join(root, "src/lib/pos-version.ts"), "utf8");
assert.match(version, /POS_BUILD = 47/);

console.log("OK pos-discount-everywhere");
