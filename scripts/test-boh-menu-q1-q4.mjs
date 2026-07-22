/**
 * Q1–Q4: delivery price UX, category mgmt, link menus, option price table.
 * No CSV import in BOH menu UI.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 258/);

const admin = read("src/components/PosMenuAdmin.tsx");
const itemEditor = read("src/components/PosMenuItemEditor.tsx");
const groupEditor = read("src/components/PosOptionGroupEditor.tsx");
const priceTable = read("src/components/PosMenuOptionPriceTable.tsx");
const menuLib = read("src/lib/pos-menu.ts");
const css = read("src/app/globals.css");
const menuPage = read("src/app/menu/page.tsx");
const checklist = read("docs/boh-menu-q1-q4-checklist.md");

// —— No CSV import UI ——
assert.doesNotMatch(admin, /นำเข้าไฟล์|FoodStory|Wongnai CSV|importCsv|csvImport/i);
assert.doesNotMatch(itemEditor, /นำเข้าไฟล์|FoodStory|importCsv/i);
assert.match(menuPage, /ไม่มีนำเข้า CSV/);
assert.doesNotMatch(menuPage, /type=["']file["']|accept=["']\.csv/i);

// —— Q1: dual price + code ——
assert.match(itemEditor, /pos-menu-price-row/);
assert.match(itemEditor, /ราคาหน้าร้าน/);
assert.match(itemEditor, /ราคาเดลิเวอรี่/);
assert.match(itemEditor, /ว่าง = ใช้หน้าร้าน/);
assert.match(itemEditor, /รหัสเมนู/);
assert.match(itemEditor, /code: code\.trim\(\) \|\| null/);
assert.match(itemEditor, /ผูกแล้ว \{linkedGroupIds\.length\} กลุ่ม/);
assert.match(groupEditor, /pos-menu-option-colhead/);
assert.match(groupEditor, /หน้าร้าน/);
assert.match(groupEditor, /เดลิเวอรี่/);
assert.match(admin, /· ส่ง ฿/);
assert.match(admin, /item\.code/);
assert.match(menuLib, /patch\.code/);
assert.match(css, /\.pos-menu-price-row/);

// —— Q2: categories ——
assert.match(admin, /แก้ชื่อหมวด/);
assert.match(admin, /updateMenuCategory/);
assert.match(admin, /archiveMenuCategory/);
assert.match(admin, /restoreMenuCategory/);
assert.match(admin, /ค้นหาเมนูหรือหมวด/);
assert.match(admin, /ทั้งหมวด/);
assert.match(menuLib, /export async function archiveMenuCategory/);
assert.match(menuLib, /export async function restoreMenuCategory/);

// —— Q3: link menus + badges ——
assert.match(admin, /pos-menu-badge--req/);
assert.match(admin, /จำเป็น/);
assert.match(admin, /ใช้กับ/);
assert.match(admin, /countMenusUsingGroup/);
assert.match(admin, /openLinkMenus/);
assert.match(admin, /saveLinkMenus/);
assert.match(admin, /ผูกเมนู/);
assert.match(admin, /optionGroupIds/);
assert.match(groupEditor, /พร้อมขาย/);
assert.match(groupEditor, /opt\.active !== false/);

// —— Q4: price table ——
assert.match(admin, /PosMenuOptionPriceTable/);
assert.match(admin, /ตั้งราคา/);
assert.match(admin, /tab === "prices"/);
assert.match(priceTable, /pos-menu-price-table/);
assert.match(priceTable, /saveMenuOptionGroupFull/);
assert.match(priceTable, /deliveryPriceDelta/);
assert.match(priceTable, /ค้นหาตัวเลือกหรือกลุ่ม/);
assert.match(css, /\.pos-menu-price-table/);

assert.match(checklist, /Q1/);
assert.match(checklist, /Q4/);
assert.match(checklist, /ไม่มี CSV/);

console.log("ok: boh-menu-q1-q4");
