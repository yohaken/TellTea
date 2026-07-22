/**
 * W4 — clearer nPos outbox (status / attempts / pending UI / void drops queue).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 260/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+46/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.23"/);

const saleSync = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java",
);
assert.match(saleSync, /ensureOutboxMeta/);
assert.match(saleSync, /isPermanentSaleError/);
assert.match(saleSync, /markQueueAttempt/);
assert.match(saleSync, /listPending/);
assert.match(saleSync, /retryPending/);
assert.match(saleSync, /cancelPending/);
assert.match(saleSync, /failedCount/);
assert.match(saleSync, /"status"/);
assert.match(saleSync, /"attempts"/);
assert.match(saleSync, /"lastError"/);
assert.match(saleSync, /removeFromQueue/);
assert.match(saleSync, /wasPending/);

const sell = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(sell, /showPendingOutboxDialog/);
assert.match(sell, /outbox_retry_one|R\.string\.outbox_retry_one/);
assert.match(sell, /cancelPending/);

const strings = read("npos-telltea/app/src/main/res/values/strings.xml");
assert.match(strings, /outbox_title_n/);
assert.match(strings, /outbox_cancel_msg/);
assert.match(strings, /btn_flush_sync_failed_n/);

assert.match(read("docs/npos-shop-work-checklist.md"), /W4/);
assert.match(read("docs/npos-remaining-checklist.md"), /W4|outbox/);

console.log("OK test-npos-outbox");
