/**
 * BOH menu item editor frame + smart photo module.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 264/);

const editor = read("src/components/PosMenuItemEditor.tsx");
const photo = read("src/components/PosMenuPhotoModule.tsx");
const imageLib = read("src/lib/pos-menu-image.ts");
const crop = read("src/components/PosMenuImageCropModal.tsx");
const css = read("src/app/globals.css");

// —— Frame layout (Wongnai-like two column) ——
assert.match(editor, /pos-menu-editor-form--frame/);
assert.match(editor, /pos-menu-editor-grid/);
assert.match(editor, /pos-menu-editor-media/);
assert.match(editor, /pos-menu-editor-fields/);
assert.match(editor, /รายละเอียด/);
assert.match(editor, /ช่องทางในการขาย/);
assert.match(editor, /PosMenuPhotoModule/);
assert.match(editor, /พร้อมขาย/);
assert.match(editor, /role="switch"/);
assert.match(editor, /pos-menu-channel-table/);
assert.match(editor, /ราคาหน้าร้าน/);
assert.match(editor, /ราคาเดลิเวอรี่/);
assert.match(editor, /ว่าง = ใช้หน้าร้าน/);
assert.match(editor, /รหัสเมนู/);
assert.match(editor, /ผูกแล้ว \{linkedGroupIds\.length\} กลุ่ม/);
assert.doesNotMatch(editor, /โหมดสี|บาร์โค้ด|Wongnai|ฤดูกาล|ใช้เวลา/);
assert.doesNotMatch(editor, /ลาก/);

// —— Smart photo module ——
assert.match(photo, /prepareMenuItemImage/);
assert.match(photo, /onDrop|onDragOver/);
assert.match(photo, /clipboard\.read|onPaste/);
assert.match(photo, /วางรูป|คลิกเลือก/);
assert.match(photo, /ThumbsUp|แนะนำ/);
assert.match(photo, /is-dragover/);
assert.match(photo, /MENU_SQUARE_PX/);
assert.match(photo, /กำลังบีบอัด/);
assert.match(photo, /image\/jpeg,image\/png,image\/webp/);

// —— Image pipeline unchanged contract ——
assert.match(imageLib, /MENU_SQUARE_PX = 480/);
assert.match(imageLib, /MENU_MAX_UPLOAD_BYTES = 2 \* 1024 \* 1024/);
assert.match(imageLib, /image\/jpeg/);
assert.match(imageLib, /isNearlySquare/);
assert.match(imageLib, /renderSquareCoverCrop/);
assert.match(crop, /commitMenuItemSquareCrop/);
assert.match(crop, /ซูม/);

// —— CSS ——
assert.match(css, /\.pos-menu-editor-grid/);
assert.match(css, /\.pos-menu-photo-drop/);
assert.match(css, /\.pos-menu-photo-badge\.is-on/);
assert.match(css, /\.pos-menu-channel-table/);
assert.match(css, /\.pos-menu-switch-row/);
assert.match(css, /min\(44rem/);

console.log("ok: boh-menu-editor-frame");
