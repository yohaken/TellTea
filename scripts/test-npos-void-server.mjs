/**
 * W5 — nposVoidSale Cloud Function + Android server void path.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 245/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.13"/);

const complete = read("functions/pos-complete-sale.js");
assert.match(complete, /voidPosSaleAdmin/);
assert.match(complete, /status:\s*"voided"|status: "voided"/);
assert.match(complete, /alreadyVoided/);
assert.match(complete, /posSaleMutations/);

const sellFn = read("functions/npos-sell.js");
assert.match(sellFn, /nposVoidSale/);
assert.match(sellFn, /voidPosSaleAdmin/);

const index = read("functions/index.js");
assert.match(index, /nposVoidSale/);

const saleSync = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java",
);
assert.match(saleSync, /VOID_URL/);
assert.match(saleSync, /nposVoidSale/);
assert.match(saleSync, /tryServerVoid/);
assert.match(saleSync, /KEY_VOID_QUEUE|voidQueue/);
assert.match(saleSync, /flushVoidQueue/);
assert.match(saleSync, /updateReceiptBill\([\s\S]*saleId/);

assert.match(read("docs/npos-shop-work-checklist.md"), /W5|nposVoidSale/);
assert.match(read("docs/npos-remaining-checklist.md"), /W5|nposVoidSale/);
assert.match(read("docs/npos-master-sell-phases.md"), /W5|nposVoidSale|P6/);

console.log("OK test-npos-void-server");
