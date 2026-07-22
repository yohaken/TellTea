/**
 * BOH add-menu flow: quick-add → optimistic item → full editor (photo + channels).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 262/);

const admin = read("src/components/PosMenuAdmin.tsx");
const editor = read("src/components/PosMenuItemEditor.tsx");
const photo = read("src/components/PosMenuPhotoModule.tsx");
const menuLib = read("src/lib/pos-menu.ts");
const css = read("src/app/globals.css");

// —— Entry points ——
assert.match(admin, /title="เพิ่มเมนู"/);
assert.match(admin, /openQuickAdd\(\{ kind: "item", categoryId/);
assert.match(admin, /quickAddTitle[\s\S]*เพิ่มเมนู/);
assert.match(admin, /submitQuickAdd/);
assert.match(admin, /addMenuItem/);

// —— Quick-add fields (ขั้นแรก) ——
assert.match(admin, /ราคาหน้าร้าน/);
assert.match(admin, /ราคาเดลิเวอรี่/);
assert.match(admin, /ว่าง = ใช้หน้าร้าน/);
assert.match(admin, /pos-menu-quick-hint/);
assert.match(admin, /หลังกดเพิ่ม จะเปิดตั้งค่ารูป/);
assert.match(admin, /เพิ่มแล้วตั้งค่าต่อ/);

// —— Optimistic open editor (ห้ามรอ snapshot อย่างเดียว) ——
assert.match(admin, /freshItemId/);
assert.match(admin, /setFreshItemId\(id\)/);
assert.match(admin, /optimistic/);
assert.match(admin, /setItems\(\(prev\) =>/);
assert.match(admin, /setScreen\(\{ kind: "edit-item", id \}\)/);
assert.match(admin, /ตั้งค่าเมนูใหม่/);
assert.match(admin, /กำลังโหลดเมนูที่เพิ่งสร้าง/);

// —— Full editor after add (ครบเฟรม) ——
assert.match(admin, /PosMenuItemEditor/);
assert.match(editor, /PosMenuPhotoModule/);
assert.match(editor, /pos-menu-editor-form--frame/);
assert.match(editor, /ช่องทางในการขาย/);
assert.match(editor, /พร้อมขาย/);
assert.match(editor, /รายละเอียดเมนู/);
assert.match(editor, /กลุ่มตัวเลือก/);
assert.match(editor, /รหัสเมนู/);
assert.match(editor, /nameEn/);
assert.match(photo, /prepareMenuItemImage/);
assert.match(photo, /onDrop|onDragOver/);
assert.match(photo, /แนะนำ/);

// —— Defaults on create ——
assert.match(menuLib, /export async function addMenuItem/);
assert.match(menuLib, /active: true/);
assert.match(menuLib, /visibleOnPos: true/);
assert.match(menuLib, /recommended: false/);
assert.match(menuLib, /source: "manual"/);

// —— CSS ——
assert.match(css, /\.pos-menu-quick-hint/);
assert.match(css, /\.pos-menu-edit-loading/);
assert.match(css, /\.pos-menu-photo-drop/);
assert.match(css, /\.pos-menu-channel-table/);

// —— Pure logic: optimistic merge keeps single id ——
function mergeOptimistic(prev, optimistic) {
  return prev.some((i) => i.id === optimistic.id) ? prev : [...prev, optimistic];
}
const base = [{ id: "a", name: "เก่า" }];
assert.equal(mergeOptimistic(base, { id: "b", name: "ใหม่" }).length, 2);
assert.equal(mergeOptimistic([{ id: "b", name: "จาก snapshot" }], { id: "b", name: "ใหม่" }).length, 1);
assert.equal(mergeOptimistic([], { id: "b", name: "ใหม่" })[0].id, "b");

console.log("ok: boh-menu-add-flow");
