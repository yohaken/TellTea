/**
 * POS 60 — Owner remote ping test (popup on POS without reload during sell).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/pos-version.ts"), /POS_BUILD\s*=\s*68\b/);
assert.match(read("src/lib/pos-devices.ts"), /requestPosDeviceOwnerPing/);
assert.match(read("src/lib/pos-devices.ts"), /ackPosDeviceOwnerPing/);
assert.match(read("src/lib/pos-devices.ts"), /ownerPingAt/);
assert.match(read("src/lib/pos-devices.ts"), /lastOwnerPingAckAt/);
assert.match(read("src/components/PosRemoteCommandBanner.tsx"), /pos-remote-ping-modal/);
assert.match(read("src/components/PosRemoteCommandBanner.tsx"), /ถ่ายรูปหน้าจอนี้ส่งมา/);
assert.match(read("src/components/PosRemoteCommandBanner.tsx"), /จะรีโหลดเองเมื่อตะกร้าว่าง/);
assert.match(read("src/components/PosAppShell.tsx"), /PosRemoteCommandBanner/);
assert.match(read("src/components/PosDeviceSetup.tsx"), /ทดสอบส่งไปเครื่อง/);
assert.match(read("src/components/PosDeviceSetup.tsx"), /requestPosDeviceOwnerPing/);
assert.match(read("firestore.rules"), /ownerPingAt/);
assert.match(read("firestore.rules"), /lastOwnerPingAckAt/);

console.log("test-pos-owner-ping: ok");
