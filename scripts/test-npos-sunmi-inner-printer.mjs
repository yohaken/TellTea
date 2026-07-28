/**
 * Gate: SUNMI InnerPrinter AIDL path for built-in printer/drawer.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+90/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.14\.67"/);
assert.match(read("npos-telltea/app/build.gradle"), /com\.sunmi:printerlibrary:1\.0\.24/);

assert.match(
  read("npos-telltea/app/src/main/AndroidManifest.xml"),
  /woyou\.aidlservice\.jiuiv5/,
);

const bridge = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/SunmiInnerPrinter.java",
);
assert.match(bridge, /InnerPrinterManager/);
assert.match(bridge, /sendRAWData/);
assert.match(bridge, /openDrawer/);
assert.match(bridge, /isSunmiDevice/);

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

assert.match(read("docs/npos-sunmi-inner-printer-checklist.md"), /1\.14\.67/);

console.log("ok: npos-sunmi-inner-printer gate");
