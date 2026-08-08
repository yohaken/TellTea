/**
 * Guard: Sunmi sale slip rendered as full-width bitmap (384/576) — fills paper.
 * Does not change USB Esc/POS; still releaseService after job (LINE MAN safe).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const bmp = read("npos-telltea/app/src/main/java/app/telltea/npos/printer/SunmiSlipBitmap.java");
assert.match(bmp, /WIDTH_80 = 576/);
assert.match(bmp, /WIDTH_58 = 384/);
assert.match(bmp, /static Bitmap render/);
assert.match(bmp, /LEFT_RIGHT/);
assert.match(bmp, /QrBitmaps/);

const sunmi = read("npos-telltea/app/src/main/java/app/telltea/npos/printer/SunmiInnerPrinter.java");
assert.match(sunmi, /SunmiSlipBitmap\.render/);
assert.match(sunmi, /printBitmapBands/);
assert.match(sunmi, /releaseService/);
assert.match(sunmi, /printSlip\([\s\S]*finally \{\s*releaseService/);

const sale = read("npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java");
assert.match(sale, /SunmiInnerPrinter\.printSlip/);
assert.match(sale, /ReceiptFormBuilder\.buildLines/);

const gradle = read("npos-telltea/app/build.gradle");
assert.ok(Number(gradle.match(/versionCode\s+(\d+)/)[1]) >= 145);

const pin = read("src/lib/npos-apk-release.ts");
assert.ok(Number(pin.match(/NPOS_SYSTEM_VERSION_CODE = (\d+)/)[1]) >= 145);

const whats = read("npos-telltea/app/src/main/java/app/telltea/npos/update/WhatsNewCatalog.java");
assert.match(whats, /versionCode == 145/);

assert.ok(Number(read("src/lib/version.ts").match(/APP_BUILD = (\d+)/)[1]) >= 753);
assert.ok(Number(read("src/lib/pos-version.ts").match(/POS_BUILD = (\d+)/)[1]) >= 198);

console.log("OK test-npos-sunmi-bitmap-slip");
