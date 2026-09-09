/**
 * Bulk menu item price table — storefront-only (delivery column removed).
 * Admin prices tab uses PosMenuChannelPriceHub; these tables remain as helpers.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.ok(Number(read("src/lib/version.ts").match(/APP_BUILD\s*=\s*(\d+)/)?.[1] || 0) >= 904);

const admin = read("src/components/PosMenuAdmin.tsx");
const itemTable = read("src/components/PosMenuItemPriceTable.tsx");
const optionTable = read("src/components/PosMenuOptionPriceTable.tsx");
const css = read("src/app/globals.css");

assert.match(admin, /PosMenuChannelPriceHub/);
assert.match(admin, /ตั้งราคา/);
assert.match(admin, /tab === "prices"/);

assert.match(itemTable, /updateMenuItem/);
assert.doesNotMatch(itemTable, /placeholder="ส่ง"|deliveryPrice/);
assert.match(itemTable, /ค้นหาเมนู รหัส หรือหมวด/);
assert.match(itemTable, /ทิ้งร่าง/);
assert.match(itemTable, /ไม่แยกหมวด/);
assert.match(itemTable, /ตารางเดียว/);

assert.match(optionTable, /saveMenuOptionGroupFull/);
assert.doesNotMatch(optionTable, /deliveryPriceDelta|placeholder="ส่ง"/);
assert.match(optionTable, /priceDelta/);

assert.match(css, /\.pos-menu-price-table/);
assert.match(css, /\.mph/);

console.log("ok: boh-menu-bulk-price");
