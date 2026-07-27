/**
 * Gate: store claim code + block unclaimed/dev writes + shop settings clock fix.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 290/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 85/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+55/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.32"/);

assert.ok(existsSync(join(root, "docs/npos-store-claim-checklist.md")));
assert.match(read("docs/npos-store-claim-checklist.md"), /1.14.32/);

const settings = read("src/lib/pos-settings.ts");
assert.match(settings, /shopSettingsUpdatedAt/);
assert.match(settings, /Do not touch generic updatedAt/);
assert.match(settings, /remoteAt === 0 && stored/);

const gate = read("functions/npos-device-gate.js");
assert.match(gate, /assertNposDeviceAllowed/);
assert.match(gate, /hashStoreCode/);
assert.match(gate, /storeClaimRequired/);
assert.match(gate, /device_not_claimed|storeClaimed/);

const claim = read("functions/npos-claim-device.js");
assert.match(claim, /nposClaimDevice/);
assert.match(claim, /storeCode/);

const sell = read("functions/npos-sell.js");
assert.match(sell, /rejectIfDeviceNotAllowed/);
assert.match(sell, /assertNposDeviceAllowed/);

const owner = read("functions/npos-owner-device.js");
assert.match(owner, /set_store_code/);
assert.match(owner, /grant_claim/);
assert.match(owner, /revoke_claim/);

const hb = read("functions/npos-heartbeat.js");
assert.match(hb, /storeClaimRequired/);
assert.match(hb, /claimStatusForHeartbeat|storeClaimed/);

const indexFn = read("functions/index.js");
assert.match(indexFn, /nposClaimDevice/);

const rules = read("firestore.rules");
assert.match(rules, /storeClaimGateOn/);
assert.match(rules, /posDeviceClaimOk/);

const manage = read("src/components/PosManagePanel.tsx");
assert.match(manage, /PosStoreClaimPanel/);
assert.match(manage, /PosBusinessSettingsView/);

const panel = read("src/components/PosStoreClaimPanel.tsx");
assert.match(panel, /setNposStoreClaimCode/);
assert.match(panel, /รหัสร้าน/);

const devices = read("src/lib/pos-devices.ts");
assert.match(devices, /storeClaimed/);
assert.match(devices, /grant_claim/);
assert.match(devices, /setNposStoreClaimCode/);

const devicesUi = read("src/components/NposDevicesPanel.tsx");
assert.match(devicesUi, /อนุญาตเคลม|grantClaim/);
assert.match(devicesUi, /ถอนเคลม|revokeClaim/);

const prefs = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/StoreClaimPrefs.java",
);
assert.match(prefs, /blocksWrites/);
const client = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/StoreClaimClient.java",
);
assert.match(client, /nposClaimDevice/);
const main = read("npos-telltea/app/src/main/java/app/telltea/npos/MainActivity.java");
assert.match(main, /refreshStoreClaimGate|submitStoreClaim/);
const sync = read("npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java");
assert.match(sync, /StoreClaimPrefs/);
assert.match(sync, /isDeviceGateError/);

const remaining = read("docs/npos-remaining-checklist.md");
assert.match(remaining, /npos-store-claim-checklist/);

const check = read("scripts/check-npos-shop.mjs");
assert.match(check, /store-claim/);

console.log("OK test-npos-store-claim");

