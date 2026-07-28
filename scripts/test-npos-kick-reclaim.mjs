/**
 * Gate: kick button in slim table + set_store_code revokes all + client hash-change bounce.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 365/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 125/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+96/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.73"/);

assert.ok(existsSync(join(root, "docs/npos-kick-reclaim-checklist.md")));
const doc = read("docs/npos-kick-reclaim-checklist.md");
assert.match(doc, /1\.14\.\d+/);
assert.match(doc, /\[x\] K1\.2/);
assert.match(doc, /\[x\] K2\.1/);
assert.match(doc, /\[x\] K3\.3/);

const panel = read("src/components/NposDevicesPanel.tsx");
assert.match(panel, /เคลียร์ seat ทั้งหมด/);
assert.match(panel, /clearNposExclusiveSeat/);
assert.match(panel, /npos-slim-text-btn|primary-btn/);
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
assert.match(remaining, /Kick-reclaim|1\.14\.\d+/);


const app = read("npos-telltea/app/src/main/java/app/telltea/npos/NposApp.java");
assert.match(app, /addKickListener/);
assert.match(app, /FLAG_ACTIVITY_CLEAR_TOP/);
assert.match(app, /MainActivity/);

assert.match(prefs, /addKickListener|CopyOnWriteArrayList/);
assert.match(prefs, /rememberStoreCode|KEY_REMEMBERED|rememberedStoreCode/);
assert.match(prefs, /kickReasonMessage/);
assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/NposApp.java"),
  /AlertDialog|kickReasonMessage/,
);
assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/MainActivity.java"),
  /EXTRA_SHOW_CLAIM_GATE|SellActivity/,
);
assert.match(
  read("npos-telltea/app/src/main/res/layout/activity_main.xml"),
  /clearRememberedCodeButton/,
);

assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/diagnose/ForegroundHeartbeat.java"),
  /INTERVAL_MS = 5_000/,
);
assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/diagnose/ForegroundHeartbeat.java"),
  /secondsUntilNextCheck|nextCheckAtMs/,
);
assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/diagnose/DeviceHeartbeat.java"),
  /MIN_INTERVAL_MS = 4_000/,
);
assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/diagnose/DeviceHeartbeat.java"),
  /Do not call onSuccess|skip applyFromServer/,
);
assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java"),
  /sellServerCheckChip|server_check_chip|ForegroundHeartbeat\.forceNow/,
);
assert.match(
  read("npos-telltea/app/src/main/res/layout/activity_sell.xml"),
  /sellServerCheckChip/,
);
assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/ui/NposNumberPad.java"),
  /padKeyMinPx|onBackspace/,
);
assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/shift/OpenShiftFlow.java"),
  /NposNumberPad/,
);
assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/MainActivity.java"),
  /storeClaimPad|NposNumberPad/,
);

assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/diagnose/ForegroundHeartbeat.java"),
  /linkStatus|LinkStatus/,
);
assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java"),
  /ForegroundColorSpan|SpannableString/,
);

console.log("OK test-npos-kick-reclaim");
