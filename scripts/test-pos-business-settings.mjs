import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const navSrc = readFileSync(join(root, "src/lib/pos-nav.ts"), "utf8");
assert.match(navSrc, /id: "settings"/);
assert.match(navSrc, /href: "\/pos\/settings\/"/);
assert.match(navSrc, /ตั้งค่าเครื่อง|ตั้งค่ากิจการ/);
assert.match(navSrc, /Settings2/);
assert.match(navSrc, /\/pos\/settings/);

const viewSrc = readFileSync(join(root, "src/components/PosBusinessSettingsView.tsx"), "utf8");
assert.match(viewSrc, /ที่อยู่บนบิล/);
assert.match(viewSrc, /ตัวอย่างเอกสาร|หัวสลิป/);
assert.match(viewSrc, /บันทึกขึ้น Firebase|บันทึกบนบิล/);
assert.match(viewSrc, /แสดงโลโก้บนใบเสร็จ/);
assert.match(viewSrc, /receiptPrintLogo/);
assert.match(viewSrc, /PromptPay/);
assert.match(viewSrc, /จัดเมนู/);
assert.match(viewSrc, /bestsellers|กลุ่มขายดี/);
assert.match(viewSrc, /pos-biz-layout/);

const manageSrc = readFileSync(join(root, "src/components/PosManagePanel.tsx"), "utf8");
assert.match(manageSrc, /PosBusinessSettingsView/);

const css = readFileSync(join(root, "src/app/globals.css"), "utf8");
assert.match(css, /\.pos-biz-module/);
assert.match(css, /\.pos-biz-preview-frame|\.pos-biz-preview-slip/);
assert.match(css, /\.pos-biz-slip-head/);

const versionSrc = readFileSync(join(root, "src/lib/pos-version.ts"), "utf8");
assert.match(versionSrc, /POS_BUILD = \d+/);

const settingsSrc = readFileSync(join(root, "src/lib/pos-settings.ts"), "utf8");
assert.match(settingsSrc, /flushPosShopSettingsUpload/);
assert.match(settingsSrc, /syncPending/);

console.log("OK pos-business-settings");
