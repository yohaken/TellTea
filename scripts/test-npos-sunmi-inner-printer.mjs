/**
 * Gate: SUNMI InnerPrinter — Thai via printText + auto-select (staff need not scan).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+111/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.14\.88"/);
assert.match(read("npos-telltea/app/build.gradle"), /com\.sunmi:printerlibrary:1\.0\.24/);
assert.match(read("src/lib/npos-apk-release.ts"), /NPOS_SYSTEM_VERSION_NAME = "1\.14\.88"/);
assert.match(read("src/lib/npos-apk-release.ts"), /NPOS_SYSTEM_VERSION_CODE = 108/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 142/);
assert.match(read("src/lib/version.ts"), /APP_BUILD = 509/);

assert.match(
  read("npos-telltea/app/src/main/AndroidManifest.xml"),
  /woyou\.aidlservice\.jiuiv5/,
);

const bridge = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/SunmiInnerPrinter.java",
);
assert.match(bridge, /InnerPrinterManager/);
assert.match(bridge, /sendRAWData/);
assert.match(bridge, /printText/);
assert.match(bridge, /printPlain/);
assert.match(bridge, /escPosTis620ToPlain/);
assert.match(bridge, /printTextBoldSegments/);
assert.match(bridge, /BOLD_ON/);
assert.match(bridge, /longDoc|stripBoldMarkers/);
assert.match(bridge, /autoSelectIfNeeded/);
assert.match(bridge, /openDrawer/);
assert.match(bridge, /isSunmiDevice/);
assert.match(bridge, /decodeTis620Manual/);

const app = read("npos-telltea/app/src/main/java/app/telltea/npos/NposApp.java");
assert.match(app, /SunmiInnerPrinter\.autoSelectIfNeeded/);

const endpoint = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/PrinterEndpoint.java",
);
assert.match(endpoint, /SUNMI/);
assert.match(endpoint, /SunmiInnerPrinter\.isSunmiDevice/);
assert.match(endpoint, /InnerPrinter/);

const transport = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/PrinterTransport.java",
);
assert.match(transport, /Kind\.SUNMI/);
assert.match(transport, /SunmiInnerPrinter\.sendRaw/);

const prefs = read("npos-telltea/app/src/main/java/app/telltea/npos/printer/PrinterPrefs.java");
assert.match(prefs, /SUNMI/);

const settings = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/SettingsActivity.java",
);
assert.match(settings, /preferSunmiEndpoint/);
assert.match(settings, /SunmiInnerPrinter\.autoSelectIfNeeded/);

assert.match(read("docs/npos-sunmi-inner-printer-checklist.md"), /1\.14\.88/);
assert.match(read("docs/npos-sunmi-inner-printer-checklist.md"), /printText/);
assert.match(read("docs/npos-staff-setup-checklist.md"), /พิมพ์ทดสอบ/);

console.log("ok: npos-sunmi-inner-printer gate");
