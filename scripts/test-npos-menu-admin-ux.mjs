/**
 * Gate: menu admin UX — search, category chip scroll, sticky save, short sold-out.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.ok(existsSync(join(root, "docs/npos-menu-admin-ux-phases.md")));
assert.match(read("docs/npos-menu-admin-ux-phases.md"), /P1|P2|P3|P4/);

assert.match(read("src/lib/version.ts"), /APP_BUILD = 546/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 158/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+126/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.14\.103"/);

const admin = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/MenuAdminActivity.java",
);
assert.match(admin, /searchField|menu_admin_search_hint/);
assert.match(admin, /matchesSearch/);
assert.match(admin, /HorizontalScrollView/);
assert.match(admin, /chipScroll/);
assert.match(admin, /menu_admin_btn_sold_out_short/);
assert.match(admin, /0\.35f|0\.65f/);

const edit = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/MenuItemEditActivity.java",
);
assert.match(edit, /footer|Sticky|sticky|บันทึก/);
assert.match(edit, /page\.addView\(footer\)/);
// Save must not live only inside the scrolling form after sticky move.
assert.match(edit, /saveBtn = NposUi\.primary/);

const strings = read("npos-telltea/app/src/main/res/values/strings.xml");
assert.match(strings, /menu_admin_btn_sold_out_short">ของหมด</);
assert.match(strings, /menu_admin_search_hint">ค้นหา</);

console.log("OK test-npos-menu-admin-ux");
