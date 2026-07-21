/**
 * nPos P2 — void, X-report, category reorder.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 219/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+15/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.10\.1"/);

assert.match(read("functions/npos-sell.js"), /nposReorderCategories/);
assert.match(read("functions/index.js"), /nposReorderCategories/);

const sync = read("npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java");
assert.match(sync, /voidReceipt/);
assert.match(sync, /printShiftReport\(Context context, String kind/);
assert.match(sync, /snapshot/);

assert.match(read("npos-telltea/app/src/main/java/app/telltea/npos/shift/ShiftPrefs.java"), /unrecordSale/);
assert.match(read("npos-telltea/app/src/main/java/app/telltea/npos/ReceiptsActivity.java"), /confirmVoid/);
assert.match(read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java"), /printXReport/);
assert.match(read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java"), /moveCategory/);
assert.match(read("npos-telltea/app/src/main/res/layout/activity_sell.xml"), /xReportButton/);
assert.match(read("docs/npos-parity-checklist.md"), /P2 — ทำแล้ว/);

console.log("OK test-npos-p2");
