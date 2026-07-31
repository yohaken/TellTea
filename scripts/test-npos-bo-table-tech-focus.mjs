/**
 * Gate: BO nPos tech table — system vs client version, no sales/rounds, shop-only.
 * Purge also wipes emu sessions/sales/logs.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 526/);

const gradle = read("npos-telltea/app/build.gradle");
const code = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const name = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || "";
assert.ok(code > 0 && name);

const release = read("src/lib/npos-apk-release.ts");
assert.match(release, /NPOS_SYSTEM_VERSION_NAME/);
assert.match(release, /NPOS_SYSTEM_VERSION_CODE/);
assert.match(release, /fetchNposSystemRelease/);
assert.match(release, /nposVersionMatch/);
assert.match(
  release,
  new RegExp(`NPOS_SYSTEM_VERSION_NAME = "${name.replace(/\./g, "\\.")}"`),
);
assert.match(release, new RegExp(`NPOS_SYSTEM_VERSION_CODE = ${code};`));

const panel = read("src/components/NposDevicesPanel.tsx");
assert.match(panel, /เวอร์ชันระบบ/);
assert.match(panel, /เวอร์ชัน nPos/);
assert.match(panel, /fetchNposSystemRelease|systemRelease/);
assert.match(panel, /purgeNposDevDevices|เก็บเฉพาะ|570F0F/);
assert.match(panel, /npos-slim-ver-check|✓/);
assert.match(panel, /รอบการขาย nPos/);
assert.doesNotMatch(panel, /openRoundBar|subscribePosSessionsForDate/);
assert.doesNotMatch(panel, /shortPosSessionId/);
assert.doesNotMatch(panel, /npos-slim-open-rounds/);
assert.doesNotMatch(panel, /saleCount.*totalSales|สด .*โอน .*PP/);
assert.doesNotMatch(panel, /cls=\{?"dev"?\}|<ClassSection[^>]*cls=.dev/);
assert.match(panel, /buckets\.dev\.length|hiddenDevCount/);

const owner = read("functions/npos-owner-device.js");
assert.match(owner, /purge_dev_devices/);
assert.match(owner, /nposDiagnose/);
assert.match(owner, /nposOpsLog/);
assert.match(owner, /posSessions/);
assert.match(owner, /posSales/);
assert.match(owner, /posSaleMutations/);
assert.match(owner, /nposScreenShots/);
assert.match(owner, /posMenuRank/);
assert.match(owner, /deletedSales/);
assert.match(owner, /keepPairingCode|keepIds|570F0F/);

const devicesLib = read("src/lib/pos-devices.ts");
assert.match(devicesLib, /purgeNposDevDevices|purge_dev_devices/);
assert.match(devicesLib, /deletedSales|deletedSessions/);

const deviceClass = read("src/lib/npos-device-class.ts");
assert.match(deviceClass, /isNposDevOrEmulator|looksLikeEmulatorHint/);

const diagnose = read("src/components/NposDiagnosePanel.tsx");
assert.match(diagnose, /isNposDevOrEmulator/);
assert.doesNotMatch(diagnose, /\(\"shop\", \"dev\", \"blocked\"\)/);

const ops = read("src/components/NposOpsLogPanel.tsx");
assert.match(ops, /isNposDevOrEmulator/);
assert.doesNotMatch(ops, /\(\"shop\", \"dev\", \"blocked\"\)/);

const posSetup = read("src/components/PosDeviceSetup.tsx");
assert.match(posSetup, /isNposDevOrEmulator/);

const css = read("src/app/globals.css");
assert.match(css, /\.npos-slim-ver-ok/);
assert.match(css, /\.npos-slim-ver-check/);

console.log("ok: npos-bo-table-tech-focus gate");
