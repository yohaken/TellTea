/**
 * Gate: cut all counter → shop/BO web entry points (nav, hub, allowNavigation).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 259/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 76/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+46/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.14\.23"/);

assert.ok(existsSync(join(root, "docs/npos-cut-bo-entry-checklist.md")));
const doc = read("docs/npos-cut-bo-entry-checklist.md");
assert.match(doc, /1\.14\.23/);
assert.match(doc, /ตัดช่องทาง|cut/);

const nav = read("src/lib/pos-nav.ts");
assert.match(nav, /POS_NAV_ITEMS/);
assert.doesNotMatch(nav, /id: "inventory"/);
assert.doesNotMatch(nav, /id: "ops"/);
assert.doesNotMatch(nav, /id: "menu"/);
assert.match(nav, /ตั้งค่าเครื่อง/);

const inv = read("src/components/PosInventoryView.tsx");
assert.doesNotMatch(inv, /mypeer-501909\.web\.app|telltea-shop|\/stock\//);
assert.match(inv, /ไม่เปิดลิงก์|stub|หลังร้าน/);

const ops = read("src/components/PosOpsNotesView.tsx");
assert.match(ops, /isPosInstallUrl|telltea-pos\.web\.app/);
assert.doesNotMatch(ops, /telltea-shop|mypeer-501909\.web\.app/);

const shift = read("src/components/PosShiftView.tsx");
assert.doesNotMatch(shift, /href=["']https?:\/\/telltea-shop|href=["']\/pos-sales/);
assert.match(shift, /ไม่เปิดลิงก์/);

const sell = read("src/components/PosSellView.tsx");
assert.doesNotMatch(sell, /href=["']\/pos\/menu/);
assert.match(sell, /หลังบ้านเท่านั้น|ไม่เปิดลิงก์/);

const cap = read("capacitor.config.ts");
assert.doesNotMatch(cap, /telltea-shop\.web\.app/);
assert.match(cap, /telltea-pos\.web\.app/);

const main = read("npos-telltea/app/src/main/java/app/telltea/npos/MainActivity.java");
assert.match(main, /buildHubNav|addHubNative/);
assert.doesNotMatch(main, /addHubWeb|openWeb\(/);
assert.doesNotMatch(main, /nav_menu|nav_inventory|nav_ops/);

const shell = read("npos-telltea/app/src/main/java/app/telltea/npos/shell/PosShellNav.java");
assert.doesNotMatch(shell, /openWeb|ACTION_VIEW|telltea-shop|\/pos\/menu/);
assert.match(shell, /SellActivity|ReceiptsActivity|ShiftActivity|SettingsActivity/);

const settings = read("npos-telltea/app/src/main/java/app/telltea/npos/SettingsActivity.java");
assert.doesNotMatch(settings, /openMenuAdminPage/);
assert.match(settings, /openMenuAdminButton/);

const shiftAct = read("npos-telltea/app/src/main/java/app/telltea/npos/ShiftActivity.java");
assert.doesNotMatch(shiftAct, /openWeb|btn_open_web_shift|ACTION_VIEW/);

const apk = read("npos-telltea/app/src/main/java/app/telltea/npos/update/ApkInstaller.java");
assert.match(apk, /isAllowedInstallUrl/);
assert.match(apk, /telltea-pos\.web\.app/);

const remaining = read("docs/npos-remaining-checklist.md");
assert.match(remaining, /npos-cut-bo-entry-checklist/);

const check = read("scripts/check-npos-shop.mjs");
assert.match(check, /cut-bo-entry/);

const navE2e = read("scripts/test-pos-nav-e2e.mjs");
assert.match(navE2e, /assertCounterNavCut/);
assert.doesNotMatch(navE2e, /menuNavLink\(page\)\.click|href", "\/pos\/menu\//);

const menuE2e = read("scripts/test-pos-menu-e2e.mjs");
assert.match(menuE2e, /assertCounterNavCut/);
assert.match(menuE2e, /\/pos\/menu\//);

const harness = read("scripts/pos-e2e-harness.mjs");
assert.match(harness, /assertCounterNavCut/);

console.log("OK test-npos-cut-bo-entry");
