/**
 * Gate: mandatory APK update via BO sync pulse — no Later snooze.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.ok(existsSync(join(root, "docs/npos-force-update-pulse-checklist.md")));
assert.ok(existsSync(join(root, "docs/npos-force-sync-checklist.md")));

const config = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/update/UpdateConfig.java",
);
assert.match(config, /AUTO_CHECK_MIN_INTERVAL_MS\s*=\s*20_000L/);
assert.doesNotMatch(config, /30 \* 60_000/);

const coordinator = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/update/UpdateCheckCoordinator.java",
);
assert.match(coordinator, /hasPendingUpdate|reassertPendingUpdate/);
assert.match(coordinator, /onServerSyncPulse/);

const prompt = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/update/UpdatePromptController.java",
);
assert.match(prompt, /reassertPendingUpdate|showPending/);
assert.match(prompt, /laterBtn\.setVisibility\(View\.GONE\)/);
assert.match(prompt, /clearPopupDismiss/);
assert.match(prompt, /UpdateBusyGate|isSellBusy|deferWhileBusy/);
assert.match(prompt, /UpdateNagVoice/);
assert.match(prompt, /maybeAutoInstall|openInstallPermission|canInstallPackages/);
assert.match(prompt, /runPermissionNudge|permissionNudgeTask = this::runPermissionNudge/);
assert.match(prompt, /รอตะกร้าว่าง|บังคับอัปเดต/);
assert.doesNotMatch(prompt, /dismissPopupFor\(activity,\s*UpdateConfig\.POPUP_SNOOZE_MS\)/);
assert.doesNotMatch(prompt, /30 \* 60_000L/);

assert.ok(
  existsSync(join(root, "npos-telltea/app/src/main/java/app/telltea/npos/update/UpdateBusyGate.java")),
);
assert.ok(
  existsSync(join(root, "npos-telltea/app/src/main/java/app/telltea/npos/update/UpdateNagVoice.java")),
);
const nag = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/update/UpdateNagVoice.java",
);
assert.match(nag, /กรุณาอัปเดตโปรแกรม/);
assert.match(nag, /3000L|3_000L/);

assert.ok(existsSync(join(root, "docs/npos-force-update-idle-checklist.md")));
const idleDoc = read("docs/npos-force-update-idle-checklist.md");
assert.match(idleDoc, /บังคับติดตั้งเสมอ|ตะกร้าว่าง|สิทธิ์ติดตั้ง/);

const prefs = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/update/ResumePrefs.java",
);
assert.match(prefs, /clearPopupDismiss/);

const nav = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/shell/PosShellNav.java",
);
assert.match(nav, /sidebarRefreshBtn/);
assert.match(nav, /setVisibility\(View\.GONE\)/);

const sell = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java",
);
assert.match(sell, /refreshMenuButton/);
assert.match(sell, /setVisibility\(View\.GONE\)/);
assert.match(sell, /PosShellNav\.bind\(this, PosShellNav\.ACTIVE_SELL, null\)/);
assert.match(sell, /setBusyGate/);
assert.match(sell, /onBusyStateChanged/);
assert.match(sell, /cart\.isEmpty/);

const strings = read("npos-telltea/app/src/main/res/values/strings.xml");
assert.match(strings, /update_popup_body_force/);
assert.match(strings, /update_popup_body_need_permission/);
assert.match(strings, /btn_allow_install_permission/);

assert.match(
  read("npos-telltea/app/src/main/res/layout/activity_sell.xml"),
  /refreshMenuButton[\s\S]*android:visibility="gone"/,
);
assert.match(
  read("npos-telltea/app/src/main/res/layout/include_pos_sidebar.xml"),
  /sidebarRefreshBtn[\s\S]*android:visibility="gone"/,
);

console.log("OK test-npos-force-update-pulse");

const hb = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/ForegroundHeartbeat.java",
);
assert.match(hb, /MAIN\.post/);
assert.match(hb, /onServerSyncPulse/);
assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/update/UpdatePromptController.java"),
  /Looper\.getMainLooper/,
);
