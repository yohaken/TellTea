/**
 * Gate: post-update what's-new card (swipe + always dismissible).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+130/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.107"/);
assert.ok(existsSync(join(root, "docs/npos-whats-new-checklist.md")));
assert.match(read("docs/npos-whats-new-checklist.md"), /1\.14\.107|1\.14\.105|WhatsNewController/);

for (const rel of [
  "npos-telltea/app/src/main/java/app/telltea/npos/update/WhatsNewCatalog.java",
  "npos-telltea/app/src/main/java/app/telltea/npos/update/WhatsNewPrefs.java",
  "npos-telltea/app/src/main/java/app/telltea/npos/update/WhatsNewController.java",
  "npos-telltea/app/src/main/java/app/telltea/npos/update/WhatsNewSlide.java",
]) {
  assert.ok(existsSync(join(root, rel)), rel);
}

const catalog = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/update/WhatsNewCatalog.java",
);
assert.match(catalog, /versionCode == 130|== 130/);
assert.match(catalog, /จ่ายสดเร็วขึ้น|ลิ้นชักเปิดทันที/);

const prefs = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/update/WhatsNewPrefs.java",
);
assert.match(prefs, /ackVersionCode|markAck|shouldShow/);

const ctrl = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/update/WhatsNewController.java",
);
assert.match(ctrl, /maybeShow|dismiss|GestureDetector|onFling/);
assert.match(ctrl, /updatePopup/);
assert.match(ctrl, /NposUi/);
assert.doesNotMatch(ctrl, /new Button\(/);
assert.doesNotMatch(ctrl, /\.setItems\s*\(/);
assert.match(ctrl, /whats_new_got_it|whats_new_close/);

const strings = read("npos-telltea/app/src/main/res/values/strings.xml");
assert.match(strings, /whats_new_title">มีอะไรใหม่</);
assert.match(strings, /whats_new_got_it/);
assert.match(strings, /whats_new_close/);

const sell = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(sell, /WhatsNewController/);
assert.match(sell, /whatsNew\.maybeShow/);

const main = read("npos-telltea/app/src/main/java/app/telltea/npos/MainActivity.java");
assert.match(main, /WhatsNewController/);
assert.match(main, /whatsNew\.maybeShow/);

console.log("OK test-npos-whats-new");
