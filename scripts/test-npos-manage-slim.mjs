/**
 * Gate: BO manage tab super-slim visuals (no workflow change).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 318/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 113/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+83/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.60"/);

assert.ok(existsSync(join(root, "docs/npos-manage-slim-checklist.md")));
assert.match(read("docs/npos-manage-slim-checklist.md"), /1\.14\.52/);

const manage = read("src/components/PosManagePanel.tsx");
assert.match(manage, /pos-manage-stack--slim/);
assert.match(manage, /PosStoreClaimPanel|PosTabletSyncPanel|NposDevicesPanel/);

const devices = read("src/components/NposDevicesPanel.tsx");
assert.match(devices, /npos-slim-row--device/);
assert.match(devices, /npos-slim-text-btn/);
assert.match(devices, /revokeClaim|grantClaim|requestNposScreenCapture/);
assert.match(devices, /npos-slim-open-rounds/);

const sync = read("src/components/PosTabletSyncPanel.tsx");
assert.match(sync, /npos-slim-text-btn/);
assert.match(sync, /setHeartbeatIntervalSec/);

const claim = read("src/components/PosStoreClaimPanel.tsx");
assert.match(claim, /npos-slim-text-btn/);
assert.match(claim, /setNposStoreClaimCode|clearNposExclusiveSeat/);

const css = read("src/app/globals.css");
assert.match(css, /\.pos-manage-stack--slim/);
assert.match(css, /\.npos-slim-row--device/);
assert.match(css, /\.npos-slim-code-bar/);

console.log("ok: npos-manage-slim gate");
