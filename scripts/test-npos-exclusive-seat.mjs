/**
 * Gate: exclusive seat (1 device) + kick + BO slim table + shift resume + claim update poll.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 393/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 129/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+100/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.77"/);

assert.ok(existsSync(join(root, "docs/npos-exclusive-seat-checklist.md")));
const doc = read("docs/npos-exclusive-seat-checklist.md");
assert.match(doc, /Exclusive seat|activeSeatInstallId|seat_taken/);
assert.match(doc, /\[x\] S3\.1/);
assert.match(doc, /\[x\] S4\.1/);

const gate = read("functions/npos-device-gate.js");
assert.match(gate, /activeSeatInstallId/);
assert.match(gate, /seatMode/);
assert.match(gate, /seat_taken|device_kicked/);
assert.match(gate, /seatHeldByMe/);

const claim = read("functions/npos-claim-device.js");
assert.match(claim, /seat_taken/);
assert.match(claim, /activeSeatInstallId/);
assert.match(claim, /runTransaction/);

const owner = read("functions/npos-owner-device.js");
assert.match(owner, /storeClaimRevokeReason/);
assert.match(owner, /kicked/);
assert.match(owner, /activeSeatInstallId/);
assert.match(owner, /clear_seat/);
assert.doesNotMatch(owner, /nposSessionClose|sessionClose/);

const hb = read("functions/npos-heartbeat.js");
assert.match(hb, /seatHeldByMe/);
assert.match(hb, /kicked/);

const sell = read("functions/npos-sell.js");
assert.match(sell, /resumed:\s*true|resumed:\s*!/);
assert.match(sell, /status", "==", "open"|status',\s*'==',\s*'open'/);
assert.match(sell, /previousDeviceId/);

const prefs = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/StoreClaimPrefs.java",
);
assert.match(prefs, /seatHeldByMe|KEY_SEAT_HELD/);
assert.match(prefs, /clearClaim|onKickedOrLostSeat/);
assert.match(prefs, /codeHash|KEY_CODE_HASH|cacheCodeHash/);
assert.match(read("npos-telltea/app/src/main/java/app/telltea/npos/diagnose/StoreClaimCrypto.java"), /telltea-store-claim:v1:/);
assert.match(read("npos-telltea/app/src/main/java/app/telltea/npos/diagnose/StoreClaimClient.java"), /matchesCachedHash|local-first|Local-first/);
assert.match(read("npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java"), /Local-first|local-first/);
assert.match(read("functions/npos-device-gate.js"), /storeClaimCodeHash/);
assert.match(read("functions/npos-heartbeat.js"), /storeClaimCodeHash/);


const shiftPrefs = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/shift/ShiftPrefs.java",
);
assert.match(shiftPrefs, /void resume\(/);
assert.match(shiftPrefs, /clearLocalOpen/);

const saleSync = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java",
);
assert.match(saleSync, /resumed/);
assert.match(saleSync, /ShiftPrefs\.resume/);

const main = read("npos-telltea/app/src/main/java/app/telltea/npos/MainActivity.java");
assert.match(main, /store_claim_kicked|onLostSeat/);
assert.match(main, /addKickListener|setKickListener/);
assert.match(main, /clearLocalOpen/);
assert.match(main, /claimPollTick|pollClaimUpdateChip/);
assert.match(main, /claimVersionChip|claimUpdateButton/);

const sellAct = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(sellAct, /blocksWrites/);

const layout = read("npos-telltea/app/src/main/res/layout/activity_main.xml");
assert.match(layout, /claimVersionChip/);
assert.match(layout, /claimUpdateButton/);

const updateCtrl = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/update/UpdatePromptController.java",
);
assert.match(updateCtrl, /forceCheck/);

const panel = read("src/components/NposDevicesPanel.tsx");
assert.match(panel, /เตะ/);
assert.match(panel, /npos-seat-slim|Seat/);
assert.match(panel, /เตะเครื่อง ≠ บังคับปิดกะ|กะไม่ปิดอัตโนมัติ/);

const claimPanel = read("src/components/PosStoreClaimPanel.tsx");
assert.match(claimPanel, /activeSeatId|เครื่องเดียว/);
assert.match(claimPanel, /เตะเครื่อง.*บังคับปิดกะ|≠ บังคับปิดกะ|เคลียร์ seat/);
assert.match(claimPanel, /เคลียร์ seat/);
assert.match(read("src/lib/pos-devices.ts"), /clearNposExclusiveSeat|clear_seat/);

const devices = read("src/lib/pos-devices.ts");
assert.match(devices, /seatMode\?:/);
assert.match(devices, /activeSeatInstallId\?:/);

const remaining = read("docs/npos-remaining-checklist.md");
assert.match(remaining, /npos-exclusive-seat-checklist/);

console.log("OK test-npos-exclusive-seat");
