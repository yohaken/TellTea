/**
 * nPos sell layout clone + local-first menu/image sync.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 232/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+25/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.14\.2"/);
assert.match(read("docs/npos-sell-layout-checklist.md"), /กริด|local-first|344/);

const layout = read("npos-telltea/app/src/main/res/layout/activity_sell.xml");
assert.match(layout, /menuGrid/);
assert.match(layout, /columnCount="5"/);
assert.match(layout, /344dp/);
assert.match(layout, /#E85D24/);
assert.match(layout, /categoryBar/);
assert.doesNotMatch(layout, /menuList/);

const sell = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(sell, /GridLayout menuGrid/);
assert.match(sell, /reloadMenu\(false\)/);
assert.match(sell, /reloadMenu\(true\)/);
assert.match(sell, /prefetchMenuImages/);
assert.match(sell, /0xFFE85D24|E85D24/);
assert.match(sell, /0xFF1E2D3D/);
assert.match(sell, /cartQtyForItem/);

const menuRepo = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/sell/MenuRepository.java",
);
assert.match(menuRepo, /Local-first|always paint from disk cache/i);
assert.match(menuRepo, /menuSavedAt/);
assert.match(menuRepo, /ซิงก์เมนูแล้ว/);

const images = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/sell/ImageLoader.java",
);
assert.match(images, /menu_img/);
assert.match(images, /prefetch/);
assert.match(images, /writeDisk|readDisk/);

assert.ok(existsSync(join(root, "docs/npos-remaining-checklist.md")));
assert.match(read("docs/npos-remaining-checklist.md"), /1\.14\./);

console.log("OK test-npos-sell-layout");
