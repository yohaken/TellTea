/**
 * POS 58 — Native update foundation (release doc + device status + settings UI).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/pos-version.ts"), /POS_BUILD\s*=\s*61\b/);
assert.match(read("src/lib/pos-native-version.ts"), /POS_NATIVE_SHELL_BUILD\s*=\s*1\b/);
assert.match(read("src/lib/pos-native-version.ts"), /PosNativeUpdateStatus/);
assert.match(read("src/lib/pos-native-release.ts"), /posNativeRelease/);
assert.match(read("src/lib/pos-native-release.ts"), /savePosNativeRelease/);
assert.match(read("src/lib/pos-native-release.ts"), /subscribePosNativeReleaseAdmin/);
assert.match(read("src/lib/pos-native.ts"), /detectPosShellKind/);
assert.match(read("src/lib/pos-native.ts"), /getPosNativeShellInfo/);
assert.match(read("src/lib/pos-devices.ts"), /shellKind/);
assert.match(read("src/lib/pos-devices.ts"), /nativeShellBuild/);
assert.match(read("src/lib/pos-devices.ts"), /reportPosDeviceNativeUpdate/);
assert.match(read("src/lib/pos-device-telemetry.ts"), /getPosNativeShellInfo/);
assert.match(read("src/components/PosNativeUpdateWatcher.tsx"), /subscribePosNativeRelease/);
assert.match(read("src/components/PosNativeUpdateWatcher.tsx"), /reportPosDeviceNativeUpdate/);
assert.match(read("src/components/PosAppShell.tsx"), /PosNativeUpdateWatcher/);
assert.match(read("src/components/PosDeviceSetup.tsx"), /savePosNativeRelease/);
assert.match(read("src/components/PosDeviceSetup.tsx"), /POS_NATIVE_UPDATE_STATUS_LABEL/);
assert.match(read("src/components/PosDeviceSetup.tsx"), /ปล่อยอัปเดต APK/);
assert.match(read("firestore.rules"), /posNativeRelease/);
assert.match(read("firestore.rules"), /shellKind/);
assert.match(read("firestore.rules"), /updateStatus/);
assert.match(read("docs/pos-native-shell.md"), /N1\.5|อัปเดต APK|posNativeRelease/);

console.log("test-pos-native-update-foundation: ok");
