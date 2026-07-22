/**
 * BOH menu management under อื่นๆ → /menu/
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const version = read("src/lib/version.ts");
assert.match(version, /APP_BUILD = 258/);

const more = read("src/app/more/page.tsx");
assert.match(more, /href="\/menu\/"/);
assert.match(more, /สร้าง · ลบ · ปรับแต่งเมนู/);
assert.match(more, /UtensilsCrossed/);

const shell = read("src/components/AppShell.tsx");
assert.match(shell, /"\/menu"/);

const page = read("src/app/menu/page.tsx");
assert.match(page, /PosMenuAdmin/);
assert.match(page, /authMode="owner"/);
assert.match(page, /role === "owner"/);
assert.doesNotMatch(page, /ensurePosDeviceAuth/);

const admin = read("src/components/PosMenuAdmin.tsx");
assert.match(admin, /authMode/);
assert.match(admin, /setMenuDbMode/);
assert.match(admin, /telltea-shop\.web\.app\/menu\//);
assert.match(admin, /แนะนำจัดการเมนูที่หลังร้าน/);

const db = read("src/lib/pos-menu-db.ts");
assert.match(db, /getMenuDb/);
assert.match(db, /MenuDbMode/);
assert.match(db, /getDb\(\)/);
assert.match(db, /getPosDb\(\)/);

const menuLib = read("src/lib/pos-menu.ts");
assert.match(menuLib, /getMenuDb/);
assert.match(menuLib, /deliveryPrice/);
assert.match(menuLib, /resolveMenuItemPrice/);
assert.doesNotMatch(menuLib, /from "\.\/pos-firebase"/);

const optLib = read("src/lib/pos-menu-options.ts");
assert.match(optLib, /getMenuDb/);
assert.match(optLib, /deliveryPriceDelta/);
assert.match(optLib, /resolveOptionPriceDelta/);

const itemEditor = read("src/components/PosMenuItemEditor.tsx");
assert.match(itemEditor, /ราคาเดลิเวอรี่/);
assert.match(itemEditor, /deliveryPrice/);

const groupEditor = read("src/components/PosOptionGroupEditor.tsx");
assert.match(groupEditor, /deliveryPriceDelta/);
assert.match(groupEditor, /ราคาเพิ่มเดลิเวอรี่/);

const types = read("src/lib/types.ts");
assert.match(types, /deliveryPrice\?:/);
assert.match(types, /deliveryPriceDelta\?:/);

const nposSell = read("functions/npos-sell.js");
assert.match(nposSell, /deliveryPrice/);
assert.match(nposSell, /deliveryPriceDelta/);

const nposModels = read("npos-telltea/app/src/main/java/app/telltea/npos/sell/MenuModels.java");
assert.match(nposModels, /deliveryPrice/);
assert.match(nposModels, /deliveryPriceDelta/);
assert.match(nposModels, /priceForChannel/);

const checklist = read("docs/boh-menu-management-checklist.md");
assert.match(checklist, /P1 — โครงหลังร้าน/);
assert.match(checklist, /P4 — ราคา 2 ช่องทาง/);

console.log("OK test-boh-menu-mgmt");
