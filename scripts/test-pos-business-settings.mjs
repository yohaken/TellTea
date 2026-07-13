import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const navSrc = readFileSync(join(root, "src/lib/pos-nav.ts"), "utf8");
assert.match(navSrc, /id: "settings"/);
assert.match(navSrc, /href: "\/pos\/settings\/"/);
assert.match(navSrc, /ตั้งค่ากิจการ/);
assert.match(navSrc, /Settings2/);
assert.match(navSrc, /\/pos\/settings/);

const viewSrc = readFileSync(join(root, "src/components/PosBusinessSettingsView.tsx"), "utf8");
assert.match(viewSrc, /ที่อยู่บนบิล/);
assert.match(viewSrc, /ตัวอย่างบนบิล/);
assert.match(viewSrc, /บันทึกบนบิล/);
assert.match(viewSrc, /PromptPay/);
assert.match(viewSrc, /pos-biz-layout/);

const pageSrc = readFileSync(join(root, "src/app/pos/settings/page.tsx"), "utf8");
assert.match(pageSrc, /PosBusinessSettingsView/);

const css = readFileSync(join(root, "src/app/globals.css"), "utf8");
assert.match(css, /\.pos-biz-module/);
assert.match(css, /\.pos-biz-preview-slip/);

const versionSrc = readFileSync(join(root, "src/lib/pos-version.ts"), "utf8");
assert.match(versionSrc, /POS_BUILD = 35/);

console.log("OK pos-business-settings");
