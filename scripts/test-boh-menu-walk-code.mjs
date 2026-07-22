/**
 * BOH menu walk-test from source (no Google login required).
 * Mirrors docs/boh-menu-walk-test-checklist.md phases A–H.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const admin = read("src/components/PosMenuAdmin.tsx");
const editor = read("src/components/PosMenuItemEditor.tsx");
const photo = read("src/components/PosMenuPhotoModule.tsx");
const menuPage = read("src/app/menu/page.tsx");
const more = read("src/app/more/page.tsx");
const image = read("src/lib/pos-menu-image.ts");
const summary = read("src/lib/pos-menu-option-summary.ts");
const menuLib = read("src/lib/pos-menu.ts");
const groupEd = read("src/components/PosOptionGroupEditor.tsx");
const priceTable = read("src/components/PosMenuOptionPriceTable.tsx");
const retired = read("src/components/PosWebRetired.tsx");
const posMenu = read("src/app/pos/menu/page.tsx");
const sell = read("src/app/pos/sell/page.tsx");

const checks = [];
function check(id, pass, note = "") {
  checks.push({ id, pass, note });
  assert.ok(pass, `${id} FAIL — ${note}`);
}

// A
check("A1.1", /AuthGate/.test(menuPage));
check("A1.2", /isOwner/.test(menuPage) && /\/more\//.test(menuPage));
check("A1.4", /isOwner[\s\S]{0,80}\/menu\//.test(more));
check("A2.1", more.includes('href="/menu/"'));
check("A3.2", /PosWebRetired/.test(posMenu));
check("A3.3", /telltea-shop\.web\.app\/menu/.test(retired));
check("A3.4", /pos-sales/.test(retired));
check("A3.5", /install|POS_APK_INSTALL/.test(retired));
check("A3.6", /!isBoh \? \(/.test(admin));
check("A3.7", /ไม่มีนำเข้า CSV/.test(menuPage));

// B
check("B1", ["เมนูอาหาร", "กลุ่มตัวเลือก", "ตั้งราคา", "โปรโมชั่น"].every((t) => admin.includes(t)));
check("B2", /tab === "groups"/.test(admin));
check("B3", /PosMenuOptionPriceTable/.test(admin));
check("B4", /กำลังพัฒนา/.test(admin));
check("B5", /tab === "categories"/.test(admin));

// C — after open category, list should be compact
check("C1", /expandedCat/.test(admin) && /pos-menu-item-main/.test(admin));
check("C1-compact", /optSummary\.chip/.test(admin) && !/ยังไม่ผูกตัวเลือก/.test(admin));
check("C2", /kind: "category"/.test(admin));
check("C3", /updateMenuCategory|renameCategory/.test(admin));
check("C4", /archiveMenuCategory/.test(admin) && /restoreMenuCategory/.test(admin));
check("C5", /reorderMenuItemsInCategory/.test(admin));
check("C6", /ค้นหาเมนูหรือหมวด/.test(admin));

// D — what you see when opening menu names
check("D-list-row", /item\.name/.test(admin) && /formatPlainNumber\(item\.price\)/.test(admin));
check("D-list-delivery", /ส่ง ฿/.test(admin));
check("D-list-chip", /pos-menu-item-opt-chip/.test(admin));
check("D-list-expand", /pos-menu-item-opts-panel/.test(admin));
check("D1", /เพิ่มแล้วตั้งค่าต่อ/.test(admin) && /setFreshItemId/.test(admin));
check("D3-compress", /preprocessMenuUpload/.test(image));
check("D3-photo", /PosMenuPhotoModule/.test(editor));
check("D4-channels", /ช่องทางในการขาย/.test(editor));
check("D5", /pos-menu-link-group-sub/.test(editor));
check("D7", /duplicateMenuItem/.test(admin));
check("D8", /chip:/.test(summary));

// E F G H
check("E", /ผูกเมนู/.test(admin) && /PosOptionGroupEditor/.test(admin));
check("E-dual", /หน้าร้าน/.test(groupEd));
check("F", /pos-menu-price-table/.test(priceTable) && /บันทึกราคา|saveMenuOptionGroupFull/.test(priceTable));
check("G", /โปรโมชั่นหน้าร้าน — กำลังพัฒนา/.test(admin));
check("H4", /PosWebRetired/.test(sell));
check("H-sync", /subscribeMenuItems/.test(menuLib));

console.log(`ok: boh-menu-walk-code ${checks.length} checks`);
