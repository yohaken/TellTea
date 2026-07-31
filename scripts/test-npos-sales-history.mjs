/**
 * Gate: sales history — native list+detail, filters, BO bill detail.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 534/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 149/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+118/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.95"/);

assert.ok(existsSync(join(root, "docs/npos-sales-history-checklist.md")));
const doc = read("docs/npos-sales-history-checklist.md");
assert.match(doc, /1\.14\.42/);
assert.match(doc, /H0|H1|H2/);
assert.match(doc, /รอบนี้|วันนี้/);
assert.match(doc, /นอกสcope/);

const receipts = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/ReceiptsActivity.java",
);
assert.match(receipts, /TimeFilter|SHIFT|TODAY/);
assert.match(receipts, /StatusFilter|PENDING|VOIDED/);
assert.match(receipts, /detailRoot|renderDetail/);
assert.match(receipts, /searchField|receipts_search_hint/);
assert.match(receipts, /NposConfirmDialog/);
assert.match(receipts, /listReceiptsNewestFirst/);

const saleSync = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java",
);
assert.match(saleSync, /listReceiptsNewestFirst/);

const bo = read("src/components/PosSalesReport.tsx");
assert.match(bo, /PosReceiptPaper|saleToLocalReceipt/);
assert.match(bo, /pos-sales-bill-split|pos-sales-bill-detail/);
assert.match(bo, /billQuery|ค้นหาเลขบิล/);
assert.doesNotMatch(bo, /onPrint=\{/);

const web = read("src/components/PosReceiptsView.tsx");
assert.match(web, /timeFilter|รอบนี้/);
assert.match(web, /billQuery/);

assert.match(read("docs/npos-remaining-checklist.md"), /npos-sales-history-checklist/);

console.log("OK test-npos-sales-history");
