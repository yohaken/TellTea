/**
 * Web POS counter retired — stubs point to nPos + shop pos-sales.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 264/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 76/);

const retired = read("src/components/PosWebRetired.tsx");
assert.match(retired, /เว็บ POS เลิกใช้แล้ว|nPos-telltea/);
assert.match(retired, /telltea-shop\.web\.app\/pos-sales/);
assert.match(retired, /POS_APK_INSTALL_PAGE_URL/);
assert.match(read("src/lib/pos-url.ts"), /telltea-pos\.web\.app\/install/);

for (const route of [
  "src/app/pos/page.tsx",
  "src/app/pos/sell/page.tsx",
  "src/app/pos/open-bills/page.tsx",
  "src/app/pos/receipts/page.tsx",
  "src/app/pos/shift/page.tsx",
  "src/app/pos/settings/page.tsx",
  "src/app/pos/menu/page.tsx",
]) {
  assert.match(read(route), /PosWebRetired/);
  assert.doesNotMatch(read(route), /PosSellView|PosBusinessSettingsView/);
}

assert.match(read("src/app/pos/layout.tsx"), /pos-web-retired-shell/);
assert.doesNotMatch(read("src/app/pos/layout.tsx"), /PosClientLayout/);

const manage = read("src/components/PosManagePanel.tsx");
assert.match(manage, /PosBusinessSettingsView/);
assert.match(manage, /embedded/);

const settings = read("src/lib/pos-settings.ts");
assert.match(settings, /setPosSettingsDbMode/);
assert.match(settings, /settingsDbMode === "owner"/);

const urls = read("src/lib/pos-url.ts");
assert.match(urls, /POS_ENTRY_URL = "https:\/\/telltea-pos\.web\.app\/install\/"/);

const policy = read("docs/pos-domain-policy.md");
assert.match(policy, /เลิกใช้/);
assert.match(policy, /ห้ามลบไซต์ telltea-pos/);

console.log("ok: web-pos-retired");
