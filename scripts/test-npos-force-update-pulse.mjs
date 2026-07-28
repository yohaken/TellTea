/**
 * Gate: mandatory APK update via BO countdown sync pulse; hide front-store refresh.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 304/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 99/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+69/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.14\.46"/);

assert.ok(existsSync(join(root, "docs/npos-force-update-pulse-checklist.md")));
const doc = read("docs/npos-force-update-pulse-checklist.md");
assert.match(doc, /1\.14\.46/);
assert.match(doc, /บังคับ|sync pulse|รีเฟรช/);

const config = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/update/UpdateConfig.java",
);
assert.match(config, /POPUP_SNOOZE_MS\s*=\s*45_000L/);
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
assert.match(prompt, /POPUP_SNOOZE_MS/);
assert.match(prompt, /reassertPendingUpdate|showPending/);
assert.doesNotMatch(prompt, /30 \* 60_000L/);

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

assert.match(
  read("npos-telltea/app/src/main/res/layout/activity_sell.xml"),
  /refreshMenuButton[\s\S]*android:visibility="gone"/,
);
assert.match(
  read("npos-telltea/app/src/main/res/layout/include_pos_sidebar.xml"),
  /sidebarRefreshBtn[\s\S]*android:visibility="gone"/,
);

assert.match(read("docs/npos-remaining-checklist.md"), /npos-force-update-pulse-checklist/);

console.log("OK test-npos-force-update-pulse");
