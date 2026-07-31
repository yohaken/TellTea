/**
 * Gate: BO equipment ✓ follows successful print/drawer + heartbeat fields.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+118/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.14\.95"/);
assert.match(read("src/lib/npos-apk-release.ts"), /NPOS_SYSTEM_VERSION_CODE = 118/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 149/);
assert.match(read("src/lib/version.ts"), /APP_BUILD = 535/);

const transport = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/PrinterTransport.java",
);
assert.match(transport, /PrinterPrefs\.saveSuccess/);

const hb = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/DeviceHeartbeat.java",
);
assert.match(hb, /drawerReady/);
assert.match(hb, /SunmiInnerPrinter\.autoSelectIfNeeded/);
assert.match(hb, /printerReady/);

const settings = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/SettingsActivity.java",
);
assert.doesNotMatch(
  settings,
  /printer_fail[\s\S]{0,120}PrinterPrefs\.markNotReady/,
);

const fn = read("functions/npos-heartbeat.js");
assert.match(fn, /drawerReady/);
assert.match(fn, /for \(const \[k, v\] of Object\.entries\(created\)/);
assert.match(fn, /!Object\.prototype\.hasOwnProperty\.call\(patch, k\)/);

assert.match(read("docs/npos-equip-status-checklist.md"), /1\.14\.95/);
assert.match(read("src/lib/pos-devices.ts"), /posDeviceEquipment/);

console.log("ok: npos-equip-status gate");
