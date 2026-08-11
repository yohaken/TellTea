/**
 * D3 — shop logo on Sunmi sale slip (fail-open, current shopJson).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const form = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/ReceiptFormBuilder.java",
);
assert.match(form, /shouldPrintShopLogo/);
assert.match(form, /logoMark\(\)/);
assert.match(form, /receiptPrintLogo/);
assert.match(form, /LOGO_MARK/);

const line = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/ReceiptSlipLine.java",
);
assert.match(line, /LOGO_MARK/);
assert.match(line, /logoMark/);

const bmp = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/SunmiSlipBitmap.java",
);
assert.match(bmp, /scaleLogoForSlip/);
assert.match(bmp, /LOGO_MARK/);
assert.match(bmp, /shopLogo/);

const sunmi = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/SunmiInnerPrinter.java",
);
assert.match(sunmi, /ImageLoader\.decode/);
assert.match(sunmi, /shouldPrintShopLogo/);
assert.match(sunmi, /printSlip\([\s\S]*JSONObject shop/);

const sale = read("npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java");
assert.match(sale, /printSlip\(app, slipLines, claim, shopForPrint\)/);

const gradle = read("npos-telltea/app/build.gradle");
assert.ok(Number(gradle.match(/versionCode\s+(\d+)/)[1]) >= 148);

const pin = read("src/lib/npos-apk-release.ts");
assert.ok(Number(pin.match(/NPOS_SYSTEM_VERSION_CODE = (\d+)/)[1]) >= 148);

const whats = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/update/WhatsNewCatalog.java",
);
assert.match(whats, /versionCode == 148/);
assert.match(whats, /โลโก้ร้านบนใบเสร็จ/);

const api = read("functions/npos-sell.js");
assert.match(api, /receiptPrintLogo/);

console.log("OK test-npos-receipt-logo-d3");
