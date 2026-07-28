/**
 * Gate: bank transfer tender (sticker QR / account) — separate from PromptPay POS QR.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 353/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 120/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+91/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.68"/);

assert.ok(existsSync(join(root, "docs/npos-bank-transfer-pay-checklist.md")));
const doc = read("docs/npos-bank-transfer-pay-checklist.md");
assert.match(doc, /1.14.68|ตรวจสอบสลิปแล้ว OK/);
assert.match(doc, /transfer|โอนเงิน|Wongnai/);

const methods = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/sell/PaymentMethods.java",
);
assert.match(methods, /TRANSFER\s*=\s*"transfer"/);
assert.match(methods, /labelTh|normalize/);

const prefs = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/shift/ShiftPrefs.java",
);
assert.match(prefs, /KEY_TRANSFER|transferTotal|transferBillCount/);
assert.match(prefs, /PaymentMethods\.TRANSFER|isTransfer|TRANSFER\.equals/);
assert.match(prefs, /expectedCash[\s\S]*cashTotal[\s\S]*cashOutTotal/);

const sell = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java",
);
assert.match(sell, /payTransferButton|showTransferConfirm|PaymentMethods\.TRANSFER/);
assert.match(sell, /pay_transfer_/);

assert.match(
  read("npos-telltea/app/src/main/res/layout/activity_sell.xml"),
  /payTransferButton/,
);

const drawer = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/CashDrawerPolicy.java",
);
assert.match(drawer, /PaymentMethods\.isCash|shouldKickAfterSale/);
assert.doesNotMatch(drawer, /TRANSFER.*true|isTransfer\(\w+\)\s*\)/);

const report = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/shift/BlindCloseReport.java",
);
assert.match(report, /transferSales|transferBills/);
assert.match(report, /openingCash \+ cashSales - this\.cashOutTotal/);

const form = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/ShiftReportFormBuilder.java",
);
assert.match(form, /โอนเงิน|transferBills|transferSales/);

const cf = read("functions/pos-complete-sale.js");
assert.match(cf, /normalizePaymentMethod/);
assert.match(cf, /transferTotal/);
assert.match(cf, /paymentMethod === "transfer"/);

assert.match(read("functions/npos-sell.js"), /transferTotal/);

assert.match(read("src/lib/types.ts"), /"transfer"/);
assert.match(read("src/lib/pos-sales-report.ts"), /transferTotal|normalizePaymentMethod/);
assert.match(read("src/components/PosSalesReport.tsx"), /โอนเงิน|transfer/);
assert.match(read("src/components/PosManagePanel.tsx"), /PosTabletSyncPanel|PosStoreClaimPanel/);

assert.match(read("docs/npos-remaining-checklist.md"), /npos-bank-transfer-pay-checklist/);

console.log("OK test-npos-bank-transfer-pay");
