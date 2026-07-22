/**
 * QA walk follow-ups: category lock, ready-to-sell not flipped by group link,
 * archive category optimistic hide, Escape modal, delivery placeholder «ส่ง».
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 267/);

const admin = read("src/components/PosMenuAdmin.tsx");
const editor = read("src/components/PosMenuItemEditor.tsx");
const modal = read("src/components/PosMenuModal.tsx");
const priceTable = read("src/components/PosMenuOptionPriceTable.tsx");
const cleanup = read("docs/boh-menu-data-cleanup.md");

// —— Category jump ——
assert.match(editor, /preferredCategoryId/);
assert.match(editor, /item\.id, preferredCategoryId/);
assert.match(admin, /freshCategoryIdRef/);
assert.match(admin, /preferredCategoryId=/);
assert.match(admin, /freshItemIdRef/);
assert.match(admin, /optimistic \? \[\.\.\.list, optimistic\]/);

// —— Ready-to-sell not flipped by linking groups ——
assert.match(editor, /item\.active !== false/);
assert.match(editor, /pos-menu-link-group-toggle/);
assert.match(editor, /aria-label=\{`ผูกกลุ่ม/);
assert.doesNotMatch(editor, /<label className="pos-menu-toggle-row pos-menu-link-group-row">/);
assert.match(editor, /optionGroups\.filter\(\(g\) => g\.active !== false\)/);

// —— Archive category optimistic + hard delete ——
assert.match(admin, /active: false/);
assert.match(admin, /archiveMenuCategory\(catId\)/);
assert.match(admin, /deleteMenuCategory/);
assert.match(admin, /ลบหมวดถาวร/);
assert.match(admin, /mode: "hard"/);

// —— Escape closes modal ——
assert.match(modal, /Escape/);
assert.match(modal, /keydown/);

// —— Delivery placeholder + empty vs 0 ——
assert.match(editor, /placeholder="ส่ง"/);
assert.match(priceTable, /placeholder="ส่ง"/);
assert.match(priceTable, /ทิ้งร่าง/);
assert.match(editor, /ใส่ 0/);

// —— Data cleanup checklist ——
assert.match(cleanup, /เพิ่มช็อตมะนาว/);
assert.match(cleanup, /ไมโล/);
assert.match(cleanup, /บุกบราวน์/);

console.log("ok: boh-menu-qa-ux");
