/**
 * Gate: nPos menu admin CRUD (P3–P5) — CF mutate + native editors + BOH live note.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+114/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.14\.91"/);
assert.match(read("src/lib/npos-apk-release.ts"), /NPOS_SYSTEM_VERSION_NAME = "1\.14\.91"/);
assert.match(read("src/lib/version.ts"), /APP_BUILD = 525/);

assert.ok(existsSync(join(root, "functions/npos-menu-admin.js")));
const cf = read("functions/npos-menu-admin.js");
assert.match(cf, /exports\.nposMenuAdminSnapshot/);
assert.match(cf, /exports\.nposMenuMutate/);
for (const action of [
  "addItem",
  "updateItem",
  "archiveItem",
  "duplicateItem",
  "addCategory",
  "updateCategory",
  "addGroup",
  "updateGroup",
  "archiveGroup",
]) {
  assert.match(cf, new RegExp(`case "${action}"`));
}
assert.match(cf, /bumpMenuVersion|menuVersion/);
assert.match(cf, /MAX_IMAGE_CHARS/);

const index = read("functions/index.js");
assert.match(index, /nposMenuAdminSnapshot/);
assert.match(index, /nposMenuMutate/);

const repo = read("npos-telltea/app/src/main/java/app/telltea/npos/sell/MenuRepository.java");
assert.match(repo, /ADMIN_SNAPSHOT_URL|nposMenuAdminSnapshot/);
assert.match(repo, /MUTATE_URL|nposMenuMutate/);
assert.match(repo, /loadAdminMenu/);
assert.match(repo, /void mutate\(/);

assert.ok(
  existsSync(join(root, "npos-telltea/app/src/main/java/app/telltea/npos/sell/MenuImageUtil.java")),
);
assert.match(read("npos-telltea/app/src/main/java/app/telltea/npos/sell/MenuImageUtil.java"), /SQUARE_PX = 480/);

const itemEdit = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/MenuItemEditActivity.java",
);
assert.match(itemEdit, /MenuImageUtil/);
assert.match(itemEdit, /ACTION_GET_CONTENT/);
assert.match(itemEdit, /deliveryPrice|optionGroupIds/);
assert.doesNotMatch(itemEdit, /new Button\(/);

const groupEdit = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/MenuGroupEditActivity.java",
);
assert.match(groupEdit, /updateGroup|selectionType/);
assert.doesNotMatch(groupEdit, /new Button\(/);

const admin = read("npos-telltea/app/src/main/java/app/telltea/npos/MenuAdminActivity.java");
assert.match(admin, /loadAdminMenu/);
assert.match(admin, /MenuItemEditActivity/);
assert.match(admin, /MenuGroupEditActivity/);
assert.match(admin, /editPrice|showArchived/);
assert.doesNotMatch(admin, /โปรโม|promotions/);

const manifest = read("npos-telltea/app/src/main/AndroidManifest.xml");
assert.match(manifest, /MenuItemEditActivity/);
assert.match(manifest, /MenuGroupEditActivity/);

const models = read("npos-telltea/app/src/main/java/app/telltea/npos/sell/MenuModels.java");
assert.match(models, /visibleOnPos/);
assert.match(models, /isArchived/);
assert.match(models, /nameEn/);

const boh = read("src/components/PosMenuAdmin.tsx");
assert.match(boh, /liveSyncNote|อัปเดตจากเครื่องขาย/);
assert.match(boh, /subscribeMenuItems/);

const phases = read("docs/npos-menu-management-phases.md");
assert.match(phases, /Phase 3|P3/);
assert.match(phases, /1\.14\.91|nposMenuMutate/);

console.log("OK test-npos-menu-admin-crud");
