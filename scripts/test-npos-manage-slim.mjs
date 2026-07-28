/**
 * Gate: BO manage tab super-slim consolidated folds.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 330/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 119/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+90/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.67"/);

assert.ok(existsSync(join(root, "docs/npos-manage-slim-checklist.md")));
assert.match(
  read("docs/npos-manage-slim-checklist.md"),
  /สัญญาณ · ตรวจ · แคป|เข้างาน · ชีพจร|ร้าน · สลิป/,
);

const manage = read("src/components/PosManagePanel.tsx");
assert.match(manage, /pos-manage-stack--slim/);
assert.match(manage, /pos-manage-stack--consolidated/);
assert.match(manage, /NposDevicesPanel/);
assert.match(manage, /สัญญาณ · ตรวจ · แคป/);
assert.match(manage, /เข้างาน · ชีพจร/);
assert.match(manage, /ร้าน · สลิป/);
assert.match(manage, /NposOpsLogPanel embedded|embedded onError/);
assert.match(manage, /PosStoreClaimPanel embedded|PosTabletSyncPanel embedded/);
// Shop settings must start collapsed (was defaultOpen).
assert.doesNotMatch(manage, /defaultOpen(?!\s*=\s*\{?false)/);
assert.match(manage, /defaultOpen=\{false\}/);
// Frequent-change first: devices before signal fold before access before shop.
const devicesAt = manage.indexOf("<NposDevicesPanel");
const signalAt = manage.indexOf("สัญญาณ · ตรวจ · แคป");
const accessAt = manage.indexOf("เข้างาน · ชีพจร");
const shopAt = manage.indexOf("ร้าน · สลิป");
assert.ok(devicesAt > 0 && signalAt > devicesAt && accessAt > signalAt && shopAt > accessAt);

const devices = read("src/components/NposDevicesPanel.tsx");
assert.match(devices, /npos-slim-row--device/);
assert.match(devices, /npos-slim-text-btn/);
assert.match(devices, /revokeClaim|grantClaim|requestNposScreenCapture/);
assert.doesNotMatch(devices, /npos-slim-open-rounds|openRoundBar/);
assert.match(devices, /เวอร์ชันระบบ|เวอร์ชัน nPos/);
assert.match(devices, /posClientVersionLabel|posDeviceEquipment/);

const sync = read("src/components/PosTabletSyncPanel.tsx");
assert.match(sync, /npos-slim-text-btn/);
assert.match(sync, /setHeartbeatIntervalSec/);
assert.match(sync, /embedded/);

const claim = read("src/components/PosStoreClaimPanel.tsx");
assert.match(claim, /npos-slim-text-btn/);
assert.match(claim, /setNposStoreClaimCode|clearNposExclusiveSeat/);
assert.match(claim, /embedded/);

assert.match(read("src/components/ManageEmbedSection.tsx"), /npos-manage-embed/);

const css = read("src/app/globals.css");
assert.match(css, /\.pos-manage-stack--slim/);
assert.match(css, /\.npos-manage-embed/);
assert.match(css, /\.npos-slim-row--device/);
assert.match(css, /\.npos-slim-code-bar/);

console.log("ok: npos-manage-slim gate");
