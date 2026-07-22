/**
 * nPos N2 — device identity + heartbeat into posDevices.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 238/);
assert.match(read("docs/npos-migration-phases.md"), /N2.*✅/);
assert.match(read("functions/npos-heartbeat.js"), /nposDeviceHeartbeat/);
assert.match(read("functions/index.js"), /nposDeviceHeartbeat/);
assert.match(read("src/lib/pos-devices.ts"), /subscribePosDevicesAdmin/);
assert.match(read("src/components/NposDevicesPanel.tsx"), /subscribePosDevicesAdmin/);
assert.match(read("src/components/NposDevicesPanel.tsx"), /เครื่อง nPos/);
assert.match(read("src/components/PosManagePanel.tsx"), /NposDevicesPanel/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+31/);
assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/diagnose/DeviceHeartbeat.java"),
  /nposDeviceHeartbeat/,
);
assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/diagnose/DeviceIdentity.java"),
  /getOrCreateInstallId/,
);
assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/MainActivity.java"),
  /ForegroundHeartbeat|DeviceHeartbeat|sendHeartbeat/,
);
assert.ok(existsSync(join(root, "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/DeviceHeartbeat.java")));
assert.ok(existsSync(join(root, "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/ForegroundHeartbeat.java")));

console.log("OK test-npos-n2-identity");
