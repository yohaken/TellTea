/**
 * Guard: Sunmi sale slips use structured rows + printColumnsString (full paper width).
 * Root cause of "narrow slip": proportional printText + Esc/POS space padding.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const form = read("npos-telltea/app/src/main/java/app/telltea/npos/printer/ReceiptFormBuilder.java");
assert.match(form, /buildLines\(/);
assert.match(form, /renderEscPos\(/);
assert.match(form, /ReceiptSlipLine/);

const line = read("npos-telltea/app/src/main/java/app/telltea/npos/printer/ReceiptSlipLine.java");
assert.match(line, /LEFT_RIGHT/);
assert.match(line, /QR_MARK/);

const sunmi = read("npos-telltea/app/src/main/java/app/telltea/npos/printer/SunmiInnerPrinter.java");
assert.match(sunmi, /printSlip\(/);
assert.match(sunmi, /printColumnsString/);
assert.match(sunmi, /syncPaperWidthFromPrinter/);
assert.match(sunmi, /getPrinterPaper/);
assert.match(sunmi, /qrPx|300|220/);
assert.match(sunmi, /proportional/);

const sale = read("npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java");
assert.match(sale, /SunmiInnerPrinter\.printSlip/);
assert.match(sale, /ReceiptFormBuilder\.buildLines/);
assert.doesNotMatch(sale, /printPlainWithClaimQr/);

const hb = read("npos-telltea/app/src/main/java/app/telltea/npos/diagnose/DeviceHeartbeat.java");
assert.match(hb, /paperWidthMm/);
assert.match(hb, /receiptCols/);

const fn = read("functions/npos-heartbeat.js");
assert.match(fn, /paperWidthMm/);
assert.match(fn, /receiptCols/);

const gradle = read("npos-telltea/app/build.gradle");
assert.ok(Number(gradle.match(/versionCode\s+(\d+)/)[1]) >= 144);

const pin = read("src/lib/npos-apk-release.ts");
assert.ok(Number(pin.match(/NPOS_SYSTEM_VERSION_CODE = (\d+)/)[1]) >= 144);

const whats = read("npos-telltea/app/src/main/java/app/telltea/npos/update/WhatsNewCatalog.java");
assert.match(whats, /versionCode == 144/);

assert.ok(Number(read("src/lib/version.ts").match(/APP_BUILD = (\d+)/)[1]) >= 752);
assert.ok(Number(read("src/lib/pos-version.ts").match(/POS_BUILD = (\d+)/)[1]) >= 197);

console.log("OK test-npos-sunmi-fullwidth-slip");
