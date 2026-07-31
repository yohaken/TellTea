/**
 * Gate: O3 menuVersion sync while Sell stays open.
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
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.14\.95"/);
assert.match(read("src/lib/npos-apk-release.ts"), /NPOS_SYSTEM_VERSION_NAME = "1\.14\.95"/);
assert.match(read("src/lib/npos-apk-release.ts"), /NPOS_SYSTEM_VERSION_CODE = 118/);

assert.ok(existsSync(join(root, "docs/npos-menu-version-sync-checklist.md")));
const doc = read("docs/npos-menu-version-sync-checklist.md");
assert.match(doc, /menuVersion|reloadMenu|O3\./);
assert.match(doc, /1\.14\.95|ship/);

const bump = read("src/lib/pos-menu-version.ts");
assert.match(bump, /bumpMenuVersion/);
assert.match(bump, /menuVersion:\s*Date\.now\(\)/);

const menu = read("src/lib/pos-menu.ts");
assert.match(menu, /bumpMenuVersion/);
assert.match(read("src/lib/pos-menu-options.ts"), /bumpMenuVersion/);

const hb = read("functions/npos-heartbeat.js");
assert.match(hb, /menuVersion/);
assert.match(hb, /meta\/pos|metaPos/);

const sellCf = read("functions/npos-sell.js");
assert.match(sellCf, /menuVersion/);
assert.match(sellCf, /nposToggleSoldOut[\s\S]*menuVersion/);
assert.match(
  sellCf,
  /await ref\.set\(\{ active: !soldOut[\s\S]*meta\/pos[\s\S]*menuVersion/,
);

const coord = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/sell/MenuSyncCoordinator.java",
);
assert.match(coord, /THROTTLE_MS\s*=\s*30_000L/);
assert.match(coord, /applyFromServer/);
assert.match(coord, /markSynced/);
assert.match(coord, /markSyncedAndNotify/);
assert.match(coord, /onMenuVersionChanged/);

const hbNative = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/DeviceHeartbeat.java",
);
assert.match(hbNative, /MenuSyncCoordinator\.applyFromServer/);
assert.match(hbNative, /import app\.telltea\.npos\.sell\.MenuSyncCoordinator/);
assert.match(hbNative, /menuVersion/);
// FQN after local Context `app` shadows package `app.telltea…` and breaks javac.
assert.doesNotMatch(hbNative, /\bapp\.telltea\.npos\.sell\.MenuSyncCoordinator\.applyFromServer/);

const repo = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/sell/MenuRepository.java",
);
assert.match(repo, /MenuSyncCoordinator\.markSynced/);
assert.match(repo, /markSyncedAndNotify/);
assert.match(repo, /menuVersion/);

const sell = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(sell, /implements MenuSyncCoordinator\.Listener/);
assert.match(sell, /MenuSyncCoordinator\.bind/);
assert.match(sell, /MenuSyncCoordinator\.unbind/);
assert.match(sell, /onMenuVersionChanged/);
assert.match(sell, /reloadMenu\(true\)/);
assert.match(sell, /sell_hub_refresh_menu/);

const strings = read("npos-telltea/app/src/main/res/values/strings.xml");
assert.match(strings, /sell_hub_refresh_menu/);
assert.match(strings, /sell_menu_refreshed_toast/);

assert.match(read("docs/npos-counter-ops-phases.md"), /O3/);
assert.match(read("docs/npos-counter-ops-phases.md"), /1\.14\.95/);
assert.match(read("scripts/check-npos-shop.mjs"), /menu-version-sync/);
assert.match(read("docs/npos-remaining-checklist.md"), /npos-menu-version-sync-checklist|O3/);

console.log("OK test-npos-menu-version-sync");
