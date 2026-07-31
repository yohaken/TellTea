/**
 * Gate: BO manage tab super-slim consolidated folds + keep 570F0F purge.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 535/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 149/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+118/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.95"/);

assert.ok(existsSync(join(root, "docs/npos-manage-slim-checklist.md")));
assert.match(read("docs/npos-manage-slim-checklist.md"), /570F0F|ตั้งค่า|สัญญาณ/);

const manage = read("src/components/PosManagePanel.tsx");
assert.match(manage, /pos-manage-stack--slim/);
assert.match(manage, /pos-manage-stack--consolidated/);
assert.match(manage, /NposDevicesPanel/);
assert.match(manage, /สัญญาณ · ตรวจ · แคป/);
assert.match(manage, /ตั้งค่า/);
assert.doesNotMatch(manage, /เข้างาน · ชีพจร|ร้าน · สลิป/);
assert.match(manage, /NposOpsLogPanel embedded|embedded onError/);
assert.match(manage, /PosStoreClaimPanel embedded|PosTabletSyncPanel embedded/);
assert.match(manage, /defaultOpen=\{false\}/);
const devicesAt = manage.indexOf("<NposDevicesPanel");
const signalAt = manage.indexOf("pos-manage-signal-fold");
const settingsAt = manage.indexOf("pos-manage-settings-fold");
assert.ok(devicesAt > 0 && signalAt > devicesAt && settingsAt > signalAt);

const devices = read("src/components/NposDevicesPanel.tsx");
assert.match(devices, /npos-slim-row--device/);
assert.match(devices, /NPOS_SHOP_KEEP_PAIRING_CODE|570F0F/);
assert.match(devices, /เก็บเฉพาะ/);
assert.match(devices, /เวอร์ชันระบบ|เวอร์ชัน nPos/);

const owner = read("functions/npos-owner-device.js");
assert.match(owner, /keepPairingCode|570F0F/);
assert.match(owner, /ไม่พบเครื่องรหัส/);

const devicesLib = read("src/lib/pos-devices.ts");
assert.match(devicesLib, /NPOS_SHOP_KEEP_PAIRING_CODE/);
assert.match(devicesLib, /keepPairingCode/);

const report = read("src/components/PosSalesReport.tsx");
assert.match(report, /ช่องทาง · เมนูขายดี/);
assert.doesNotMatch(report, /สรุปยอด · รอบ nPos · เมนูขายดี/);
assert.doesNotMatch(report, /แยกตามรอบ nPos/);

const sync = read("src/components/PosTabletSyncPanel.tsx");
assert.match(sync, /embedded/);
const claim = read("src/components/PosStoreClaimPanel.tsx");
assert.match(claim, /embedded/);

assert.match(read("src/components/ManageEmbedSection.tsx"), /npos-manage-embed/);

const css = read("src/app/globals.css");
assert.match(css, /\.pos-manage-stack--slim/);
assert.match(css, /\.npos-manage-embed/);

console.log("ok: npos-manage-slim gate");
