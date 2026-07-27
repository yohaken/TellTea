/**
 * Gate: kick button in slim table + set_store_code revokes all + client hash-change bounce.
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

assert.ok(existsSync(join(root, "docs/npos-kick-reclaim-checklist.md")));
const doc = read("docs/npos-kick-reclaim-checklist.md");
assert.match(doc, /1\.14\.32/);
assert.match(doc, /\[x\] K1\.2/);
assert.match(doc, /\[x\] K2\.1/);
assert.match(doc, /\[x\] K3\.3/);

const panel = read("src/components/NposDevicesPanel.tsx");
assert.match(panel, /เคลียร์ seat ทั้งหมด/);
assert.match(panel, /clearNposExclusiveSeat/);
assert.match(panel, /primary-btn/);
assert.match(panel, /canKick|storeClaimed \|\| activeSeatId/);
assert.match(panel, /กะไม่ปิด/);

const claimPanel = read("src/components/PosStoreClaimPanel.tsx");
assert.match(claimPanel, /revokedCount/);
assert.match(claimPanel, /เปลี่ยนรหัสแล้ว|เตะ \$\{res\.revokedCount\}/);

const devices = read("src/lib/pos-devices.ts");
assert.match(devices, /revokedCount/);
assert.match(devices, /setNposStoreClaimCode/);

const owner = read("functions/npos-owner-device.js");
assert.match(owner, /set_store_code/);
assert.match(owner, /code_changed/);
assert.match(owner, /activeSeatInstallId:\s*""/);
assert.match(owner, /revokedCount:\s*claimed\.size/);

const prefs = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/StoreClaimPrefs.java",
);
assert.match(prefs, /REASON_CODE_CHANGED/);
assert.match(prefs, /hashChanged/);
assert.match(prefs, /wasCodeChanged/);
assert.match(prefs, /kickReason/);

const main = read("npos-telltea/app/src/main/java/app/telltea/npos/MainActivity.java");
assert.match(main, /store_claim_code_changed/);
assert.match(main, /wasCodeChanged/);

const strings = read("npos-telltea/app/src/main/res/values/strings.xml");
assert.match(strings, /store_claim_code_changed/);
assert.match(strings, /รหัสร้านเปลี่ยน/);

const remaining = read("docs/npos-remaining-checklist.md");
assert.match(remaining, /npos-kick-reclaim-checklist/);
assert.match(remaining, /1\.14\.32/);

console.log("OK test-npos-kick-reclaim");
