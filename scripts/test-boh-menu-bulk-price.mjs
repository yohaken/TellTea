/**
 * Bulk menu item price table lives under ตั้งราคา alongside option prices.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 267/);

const admin = read("src/components/PosMenuAdmin.tsx");
const itemTable = read("src/components/PosMenuItemPriceTable.tsx");
const css = read("src/app/globals.css");

assert.match(admin, /PosMenuItemPriceTable/);
assert.match(admin, /PosMenuOptionPriceTable/);
assert.match(admin, /priceScope/);
assert.match(admin, /setPriceScope\("items"\)/);
assert.match(admin, /setPriceScope\("options"\)/);
assert.match(admin, /pos-menu-price-hub/);
assert.match(admin, /pos-menu-price-scope/);

assert.match(itemTable, /updateMenuItem/);
assert.match(itemTable, /placeholder="ส่ง"/);
assert.match(itemTable, /ค้นหาเมนู รหัส หรือหมวด/);
assert.match(itemTable, /deliveryPrice/);
assert.match(itemTable, /ทิ้งร่าง/);
assert.match(itemTable, /ไม่แยกหมวด/);
assert.match(itemTable, /ตารางเดียว/);

assert.match(css, /\.pos-menu-price-hub/);
assert.match(css, /\.pos-menu-price-scope/);

console.log("ok: boh-menu-bulk-price");
