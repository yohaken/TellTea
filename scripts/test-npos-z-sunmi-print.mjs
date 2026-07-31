/**
 * Gate: X/Z shift reports must fully print on SUNMI (no mid-slip abort after banner).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 537/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 151/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+120/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.14\.97"/);

assert.ok(existsSync(join(root, "docs/npos-z-sunmi-print-checklist.md")));
assert.match(read("docs/npos-z-sunmi-print-checklist.md"), /1\.14\.97/);
assert.match(read("docs/npos-z-sunmi-print-checklist.md"), /bold ≥ 6|longDoc|พิมพ์ก้อนเดียว/);

const sunmi = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/SunmiInnerPrinter.java",
);
assert.match(sunmi, /longDoc/);
assert.match(sunmi, /stripBoldMarkers/);
assert.match(sunmi, /boldOns >= 6|boldOnCount/);
assert.match(sunmi, /พิมพ์สรุปรอบแล้ว/);

const esc = read("npos-telltea/app/src/main/java/app/telltea/npos/printer/EscPos.java");
assert.match(esc, /stripBoldMarkers/);
assert.match(esc, /boldOnCount/);

const saleSync = read("npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java");
const fnStart = saleSync.indexOf("public void printShiftReport(\n");
assert.ok(fnStart > 0, "printShiftReport( BlindCloseReport ) overload");
const body = saleSync.slice(fnStart, fnStart + 9000);
assert.match(body, /PrinterPrefs\.receiptCols/);
// onDone must run from transport callback, then return (not fire before print finishes)
assert.match(body, /transport\.send\([\s\S]*?onDone\.run\(\)/);
assert.match(body, /return;\n\s*\}/);

const shift = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/ShiftReportFormBuilder.java",
);
assert.match(shift, /รายงานสรุปรอบ/);
assert.match(shift, /BOLD_ON/);

assert.match(read("scripts/check-npos-shop.mjs"), /z-sunmi-print|thermal-all-docs/);

console.log("OK test-npos-z-sunmi-print");
