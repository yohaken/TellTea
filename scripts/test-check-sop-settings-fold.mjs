/**
 * SmartCheck SOP setup on /check (owner tab); settings uses foldable categories.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const version = read("src/lib/version.ts");
const settings = read("src/app/settings/page.tsx");
const check = read("src/app/check/page.tsx");
const more = read("src/app/more/page.tsx");
const fold = read("src/components/SettingsFold.tsx");
const nav = read("src/components/NavMenuOrderSetup.tsx");
const profile = read("src/components/BusinessProfileSetup.tsx");
const update = read("src/components/AppUpdateSetup.tsx");
const catalog = read("src/components/ChecklistSetup.tsx");

assert.match(version, /APP_BUILD = 231/);
assert.doesNotMatch(settings, /ChecklistSetup/);
assert.match(settings, /BusinessProfileSetup/);
assert.match(settings, /NavMenuOrderSetup/);
assert.match(settings, /AppUpdateSetup/);
assert.match(settings, /พับ\/ขยาย|พับ/);
assert.match(check, /ChecklistSetup/);
assert.match(check, /รายการ SOP/);
assert.match(check, /ownerView === "setup"/);
assert.match(check, /stock-owner-tabs/);
assert.match(check, /เช็ค → รายการ SOP/);
assert.doesNotMatch(check, /อื่นๆ → ตั้งค่าโมดูล/);
assert.match(more, /SmartCheck อยู่หน้าเช็ค/);
assert.match(fold, /settings-fold-toggle/);
assert.match(fold, /aria-expanded/);
assert.match(nav, /SettingsFold/);
assert.match(profile, /SettingsFold/);
assert.match(update, /SettingsFold/);
assert.match(catalog, /รายการ SOP/);

console.log("OK test-check-sop-settings-fold");
