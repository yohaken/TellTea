/**
 * Gate: BO device table shows system vs client version + equipment readiness.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 331/);

const devicesLib = read("src/lib/pos-devices.ts");
assert.match(devicesLib, /versionName/);
assert.match(devicesLib, /drawerReady/);
assert.match(devicesLib, /posClientVersionLabel/);
assert.match(devicesLib, /posDeviceEquipment/);
assert.match(devicesLib, /nPos-telltea/);
assert.match(devicesLib, /posClientVersionName/);

const hb = read("functions/npos-heartbeat.js");
assert.match(hb, /versionName,/);
assert.match(hb, /drawerReady/);

const panel = read("src/components/NposDevicesPanel.tsx");
assert.match(panel, /posClientVersionLabel/);
assert.match(panel, /posDeviceEquipment/);
assert.match(panel, /เวอร์ชันระบบ/);
assert.match(panel, /เวอร์ชัน nPos/);
assert.match(panel, /อุปกรณ์/);
assert.match(panel, /equip\.short/);
assert.doesNotMatch(panel, /APK \{d\.nativeShellBuild \|\| d\.appBuild/);

const css = read("src/app/globals.css");
assert.match(css, /\.npos-slim-equip/);
assert.match(css, /minmax\(4\.8rem, max-content\)/);

assert.match(read("docs/npos-manage-slim-checklist.md"), /เวอร์ชันระบบ|เวอร์ชัน nPos|อุปกรณ์|APP_BUILD.?329/);

console.log("ok: npos-bo-device-version-equip gate");
