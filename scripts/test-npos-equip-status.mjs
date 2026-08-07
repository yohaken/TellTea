/**
 * Gate: BO equipment ✓ follows successful print/drawer + heartbeat fields.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.ok(Number((read("npos-telltea/app/build.gradle").match(/versionCode\s+(\d+)/) || [])[1]) >= 130);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"\d+"/);
assert.ok(Number((read("src/lib/npos-apk-release.ts").match(/NPOS_SYSTEM_VERSION_CODE = (\d+)/) || [])[1]) >= 130);
assert.ok(Number(read("src/lib/pos-version.ts").match(/POS_BUILD = (\d+)/)[1]) >= 166);
assert.ok(Number(read("src/lib/version.ts").match(/APP_BUILD = (\d+)/)[1]) >= 581);

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

assert.match(read("docs/npos-equip-status-checklist.md"), /1\.14\.\d+/);
assert.match(read("src/lib/pos-devices.ts"), /posDeviceEquipment/);

console.log("ok: npos-equip-status gate");
