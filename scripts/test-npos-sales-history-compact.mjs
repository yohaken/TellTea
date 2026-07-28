/**
 * Gate: sales history custom date + BO compact receipt/manage.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 325/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 119/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+89/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.66"/);

assert.ok(existsSync(join(root, "docs/npos-sales-history-compact-checklist.md")));
const doc = read("docs/npos-sales-history-compact-checklist.md");
assert.match(doc, /1\.14\.47/);
assert.match(doc, /Custom|ระบุวัน/);
assert.match(doc, /VAT|ลูกค้า|Refund|void/);

const receipts = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/ReceiptsActivity.java",
);
assert.match(receipts, /CUSTOM/);
assert.match(receipts, /DatePickerDialog|pickCustomDay/);
assert.match(receipts, /customerName|customerPhone/);
assert.match(receipts, /vatBaht|serviceChargeBaht/);
assert.doesNotMatch(receipts, /TextView\s+net\s*=/);
assert.match(receipts, /detailRoot\.addView\(\s*metaRow\(\s*getString\(R\.string\.cart_net_label\)/);

assert.match(read("src/components/PosSalesReport.tsx"), /type="date"|dateInputValue/);
assert.match(read("src/components/PosSalesReport.tsx"), /pos-sales-fold/);
assert.match(read("src/components/PosSalesReport.tsx"), /statusFilter|voided/);
assert.match(read("src/components/PosSalesReport.tsx"), /compact/);

assert.match(read("src/components/PosManagePanel.tsx"), /defaultOpen/);
assert.match(read("src/components/PosManagePanel.tsx"), /pos-manage-stack--dense/);
assert.match(read("src/components/PosStoreClaimPanel.tsx"), /defaultOpen=\{false\}/);
assert.match(read("src/components/NposDevicesPanel.tsx"), /defaultOpen=\{false\}/);

assert.match(read("src/components/PosBusinessSettingsView.tsx"), /preview-first|pos-biz-preview--print/);
assert.match(read("src/lib/pos-printer/receipt-template.ts"), /customer|vat_service/);
assert.match(read("src/lib/pos-printer/types.ts"), /customerPhone|vatBaht|serviceChargeBaht/);

assert.match(read("docs/npos-remaining-checklist.md"), /npos-sales-history-compact-checklist/);

console.log("OK test-npos-sales-history-compact");
