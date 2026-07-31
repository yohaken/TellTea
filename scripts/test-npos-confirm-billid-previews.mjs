/**
 * Gate: friendly confirms · bill id on lists · shop-settings doc samples.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 528/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 146/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+115/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.92"/);

const confirm = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/ui/NposConfirmDialog.java",
);
assert.match(confirm, /NposUi\.(primary|ghost|secondary)/);
assert.match(confirm, /ConfirmAction/);
assert.doesNotMatch(confirm, /\.setPositiveButton\s*\(/);

const receipts = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/ReceiptsActivity.java",
);
assert.match(receipts, /NposConfirmDialog/);
assert.match(receipts, /formatBillDisplay|provisionalBillNo/);
assert.doesNotMatch(receipts, /\.setPositiveButton\s*\(/);

const sell = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(sell, /NposConfirmDialog/);
assert.match(sell, /formatBillDisplay\(SaleSync\.provisionalBillNo/);

const saleSync = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java",
);
assert.match(saleSync, /รอส่ง-/);
assert.match(saleSync, /rememberReceipt\(app, payload, provisionalBillNo/);
assert.match(saleSync, /formatBillDisplay/);

assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/shift/OpenShiftFlow.java"),
  /NposConfirmDialog/,
);
assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/shift/BlindCloseFlow.java"),
  /NposConfirmDialog/,
);
assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/NposApp.java"),
  /NposConfirmDialog/,
);

const biz = read("src/components/PosBusinessSettingsView.tsx");
assert.match(biz, /DocPreview|sampleReceiptCases|sampleShiftReportPayload/);
assert.match(biz, /buildUnifiedReceiptBody|buildShiftReportHtml/);

const samples = read("src/lib/pos-printer/receipt-template.ts");
assert.match(samples, /sampleReceiptCases/);
assert.match(samples, /cash_change|discount|pending/);
assert.match(read("src/lib/pos-printer/shift-snapshot-template.ts"), /sampleShiftReportPayload/);

assert.match(read("src/components/PosSalesReport.tsx"), /pos-sales-bill-id/);
assert.match(read("src/components/PosPendingSyncPanel.tsx"), /pos-sales-bill-id/);
assert.match(read("src/components/NposDevicesPanel.tsx"), /PosConfirmDialog/);
assert.doesNotMatch(read("src/components/NposDevicesPanel.tsx"), /window\.confirm/);

assert.ok(existsSync(join(root, "docs/npos-friendly-ui-checklist.md")));
assert.match(read("docs/npos-friendly-ui-checklist.md"), /1\.14\.42|NposConfirmDialog/);

console.log("OK test-npos-confirm-billid-previews");
