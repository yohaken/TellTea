/**
 * Guard: nPos must release Sunmi InnerPrinter after each job (share with LINE MAN).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const sunmi = read("npos-telltea/app/src/main/java/app/telltea/npos/printer/SunmiInnerPrinter.java");
assert.match(sunmi, /unBindService/);
assert.match(sunmi, /releaseService\(\)/);
assert.match(sunmi, /resetPrinterDefaults/);
assert.match(sunmi, /printerInit/);
assert.match(sunmi, /LINE MAN/);
assert.match(sunmi, /printSlip\([\s\S]*finally \{\s*releaseService/);
assert.match(sunmi, /printPlain\([\s\S]*finally \{\s*releaseService/);
assert.match(sunmi, /openDrawer\([\s\S]*finally \{\s*releaseService/);
assert.match(sunmi, /sendRawBytes\([\s\S]*finally \{\s*releaseService/);

const gradle = read("npos-telltea/app/build.gradle");
assert.ok(Number(gradle.match(/versionCode\s+(\d+)/)[1]) >= 145);

const pin = read("src/lib/npos-apk-release.ts");
assert.ok(Number(pin.match(/NPOS_SYSTEM_VERSION_CODE = (\d+)/)[1]) >= 145);

const whats = read("npos-telltea/app/src/main/java/app/telltea/npos/update/WhatsNewCatalog.java");
assert.match(whats, /versionCode == 145/);

assert.ok(Number(read("src/lib/version.ts").match(/APP_BUILD = (\d+)/)[1]) >= 753);
assert.ok(Number(read("src/lib/pos-version.ts").match(/POS_BUILD = (\d+)/)[1]) >= 198);

const checklist = read("docs/npos-sunmi-inner-printer-checklist.md");
assert.match(checklist, /LINE MAN/);
assert.match(checklist, /unBindService/);

console.log("OK test-npos-sunmi-printer-release");
