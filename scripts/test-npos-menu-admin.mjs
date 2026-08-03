/**
 * Gate: nPos native menu admin (P1 hub + P2 sold-out sheet).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+130/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.107"/);
assert.match(read("src/lib/npos-apk-release.ts"), /NPOS_SYSTEM_VERSION_NAME = "1.14.107"/);
assert.match(read("src/lib/npos-apk-release.ts"), /NPOS_SYSTEM_VERSION_CODE = 130/);

assert.ok(existsSync(join(root, "docs/npos-menu-management-phases.md")));
const phases = read("docs/npos-menu-management-phases.md");
assert.match(phases, /Phase 1|P1/);
assert.match(phases, /Phase 2|P2/);
assert.match(phases, /MenuAdminActivity|กดค้าง|ของหมด/);

const main = read("npos-telltea/app/src/main/java/app/telltea/npos/MainActivity.java");
assert.match(main, /nav_menu/);
assert.match(main, /PosShellNav\.openMenuAdmin/);
// Hub order: sell then menu
const sellIdx = main.indexOf("R.string.nav_sell");
const menuIdx = main.indexOf("R.string.nav_menu");
const billsIdx = main.indexOf("R.string.nav_open_bills");
assert.ok(sellIdx > 0 && menuIdx > sellIdx && billsIdx > menuIdx, "hub order sell → menu → bills");

const shell = read("npos-telltea/app/src/main/java/app/telltea/npos/shell/PosShellNav.java");
assert.match(shell, /ACTIVE_MENU|nav_menu/);
assert.match(shell, /openMenuAdmin|MenuAdminActivity/);
assert.match(shell, /ShiftPrefs\.isOpen/);
// Rail order: sell → menu → open bills
const shellSell = shell.indexOf("R.string.nav_sell");
const shellMenu = shell.indexOf("R.string.nav_menu");
const shellBills = shell.indexOf("R.string.nav_open_bills");
assert.ok(
  shellSell > 0 && shellMenu > shellSell && shellBills > shellMenu,
  "PosShellNav order sell → menu → bills",
);

const admin = read("npos-telltea/app/src/main/java/app/telltea/npos/MenuAdminActivity.java");
assert.match(admin, /EXTRA_FOCUS_ITEM_ID/);
assert.match(admin, /ShiftPrefs\.isOpen/);
assert.match(admin, /loadAdminMenu/);
assert.match(admin, /MenuItemEditActivity|MenuGroupEditActivity/);
assert.match(admin, /menu_admin_tab_items|Tab\.ITEMS/);
assert.match(admin, /menu_admin_tab_groups|Tab\.GROUPS/);
assert.match(admin, /menu_admin_tab_prices|Tab\.PRICES/);
assert.match(admin, /toggleSoldOut|runToggle/);
assert.match(admin, /NposUi/);
assert.doesNotMatch(admin, /new Button\(/);
assert.doesNotMatch(admin, /โปรโม|promotions/);

const sell = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(sell, /showItemActionsSheet/);
assert.match(sell, /menu_item_action_sold_out|menu_item_action_restore/);
assert.match(sell, /menu_item_action_edit/);
assert.match(sell, /MenuAdminActivity\.EXTRA_FOCUS_ITEM_ID/);
assert.match(sell, /showSellHubMenu[\s\S]*nav_menu/);
assert.match(sell, /PosShellNav\.openMenuAdmin/);
assert.doesNotMatch(sell, /confirmToggleSoldOut/);

const strings = read("npos-telltea/app/src/main/res/values/strings.xml");
assert.match(strings, /nav_menu">จัดการเมนู</);
assert.match(strings, /menu_admin_need_shift/);
assert.match(strings, /menu_item_actions_title/);

assert.match(read("npos-telltea/app/src/main/AndroidManifest.xml"), /MenuAdminActivity/);

const cf = read("functions/npos-sell.js");
assert.match(cf, /nposToggleSoldOut[\s\S]*menuVersion/);

const coord = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/sell/MenuSyncCoordinator.java",
);
assert.match(coord, /markSyncedAndNotify/);

console.log("OK test-npos-menu-admin");
