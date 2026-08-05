/**
 * Gate: post-update what's-new card (swipe + click-through).
 *
 * Structural rule: current APK versionCode in build.gradle MUST have non-empty
 * slides in WhatsNewCatalog — every ship shows the popup for staff to click through.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const gradle = read("npos-telltea/app/build.gradle");
const code = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const name = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || "";
assert.ok(code > 0, "build.gradle versionCode missing");
assert.ok(name, "build.gradle versionName missing");

assert.ok(existsSync(join(root, "docs/npos-whats-new-checklist.md")));
const doc = read("docs/npos-whats-new-checklist.md");
assert.match(doc, /WhatsNewController|WhatsNewCatalog/);
assert.match(
  doc,
  new RegExp(String(code)),
  `docs/npos-whats-new-checklist.md must mention current versionCode ${code}`,
);
assert.match(
  doc,
  new RegExp(name.replace(/\./g, "\\.")),
  `docs/npos-whats-new-checklist.md must mention current versionName ${name}`,
);
assert.match(doc, /ทุก.*versionCode|versionCode.*สไลด์|บังคับ.*สไลด์|CI/);

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
// Current build must ship slides — staff click ถัดไป through each page.
assert.match(
  catalog,
  new RegExp(`versionCode\\s*==\\s*${code}`),
  `WhatsNewCatalog must define slides for versionCode ${code}`,
);
const blockMatch = catalog.match(
  new RegExp(
    `if\\s*\\(\\s*versionCode\\s*==\\s*${code}\\s*\\)\\s*\\{([\\s\\S]*?)\\n\\s*\\}`,
  ),
);
assert.ok(blockMatch, `could not parse WhatsNewCatalog block for ${code}`);
const block = blockMatch[1];
const slideCount = (block.match(/new WhatsNewSlide\s*\(/g) || []).length;
assert.ok(
  slideCount >= 1,
  `WhatsNewCatalog versionCode ${code} must have ≥1 WhatsNewSlide (got ${slideCount})`,
);
assert.match(catalog, /Ship rule|ทุก.*versionCode|CI/);

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
assert.match(ctrl, /whats_new_next|onPrimary|nextPage/);

const strings = read("npos-telltea/app/src/main/res/values/strings.xml");
assert.match(strings, /whats_new_title">มีอะไรใหม่</);
assert.match(strings, /whats_new_got_it/);
assert.match(strings, /whats_new_close/);
assert.match(strings, /whats_new_next/);

const sell = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(sell, /WhatsNewController/);
assert.match(sell, /whatsNew\.maybeShow/);

const main = read("npos-telltea/app/src/main/java/app/telltea/npos/MainActivity.java");
assert.match(main, /WhatsNewController/);
assert.match(main, /whatsNew\.maybeShow/);

console.log(`OK test-npos-whats-new ${name} (${code}) slides=${slideCount}`);
