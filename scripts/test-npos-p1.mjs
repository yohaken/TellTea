/**
 * nPos P1 — offline QR, cash keypad, richer Z-report.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 216/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+12/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.9\.1"/);
assert.match(read("npos-telltea/app/build.gradle"), /zxing:core/);

assert.ok(existsSync(join(root, "npos-telltea/app/src/main/java/app/telltea/npos/sell/QrBitmaps.java")));

const sell = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(sell, /showCashKeypad/);
assert.match(sell, /QrBitmaps\.encode/);
assert.match(sell, /pay_cash_exact|ตรงพอดี/);

const shift = read("npos-telltea/app/src/main/java/app/telltea/npos/shift/ShiftPrefs.java");
assert.match(shift, /recordSale/);
assert.match(shift, /discountTotal/);
assert.match(shift, /saleCount/);

assert.match(read("npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java"), /บิลทั้งหมด/);
assert.match(read("docs/npos-parity-checklist.md"), /P1 — ทำแล้ว/);

console.log("OK test-npos-p1");
