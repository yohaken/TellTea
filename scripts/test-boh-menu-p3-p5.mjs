/**
 * P3–P5: BOH search/duplicate/archive, sell price channel, cut /pos/menu/ admin.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.ok(Number(read("src/lib/version.ts").match(/APP_BUILD\s*=\s*(\d+)/)?.[1] || 0) >= 904);
assert.ok(Number(read("src/lib/pos-version.ts").match(/POS_BUILD\s*=\s*(\d+)/)?.[1] || 0) >= 102);

// P3 — search / duplicate / archive
const admin = read("src/components/PosMenuAdmin.tsx");
assert.match(admin, /pos-menu-search/);
assert.match(admin, /filterCategoryId/);
assert.match(admin, /visibilityFilter/);
assert.match(admin, /duplicateMenuItem/);
assert.match(admin, /duplicateMenuOptionGroup/);
assert.match(admin, /archiveMenuItem/);
assert.match(admin, /archiveMenuOptionGroup/);
assert.match(admin, /เก็บเข้าคลัง/);
assert.match(admin, /เก็บแล้ว/);

const menuLib = read("src/lib/pos-menu.ts");
assert.match(menuLib, /export async function duplicateMenuItem/);
assert.match(menuLib, /export async function archiveMenuItem/);
assert.match(menuLib, /export async function restoreMenuItem/);

const optLib = read("src/lib/pos-menu-options.ts");
assert.match(optLib, /export async function duplicateMenuOptionGroup/);
assert.match(optLib, /export async function archiveMenuOptionGroup/);

assert.match(read("src/components/PosMenuItemEditor.tsx"), /เก็บเข้าคลัง/);
assert.match(read("src/components/PosOptionGroupEditor.tsx"), /เก็บเข้าคลัง/);

// P4 — sell channel locked to storefront (delivery UI retired)
const sell = read("src/components/PosSellView.tsx");
assert.match(sell, /priceChannel/);
assert.match(sell, /resolveMenuItemPrice/);
assert.match(sell, /channel=\{priceChannel\}/);
assert.match(sell, /priceChannel: MenuPriceChannel = "store"/);
assert.doesNotMatch(sell, /applyPriceChannel|pos-sell-channel/);

const cart = read("src/lib/pos-menu-cart.ts");
assert.match(cart, /selectionsFromCounts\([\s\S]*channel/);
assert.match(cart, /resolveOptionPriceDelta/);
assert.match(cart, /computeLineUnitPrice/);
assert.match(cart, /repriceSelections/);

const picker = read("src/components/PosOptionPickerModal.tsx");
assert.match(picker, /channel\?: MenuPriceChannel/);
assert.match(picker, /resolveOptionPriceDelta\(opt, channel\)/);

// channel math smoke (mirrors resolve helpers — delivery still in schema)
function resolveMenuItemPrice(item, channel = "store") {
  if (channel === "delivery" && typeof item.deliveryPrice === "number") {
    return Math.max(0, item.deliveryPrice);
  }
  return Math.max(0, item.price);
}
function resolveOptionPriceDelta(choice, channel = "store") {
  if (channel === "delivery" && typeof choice.deliveryPriceDelta === "number") {
    return Math.max(0, choice.deliveryPriceDelta);
  }
  return Math.max(0, choice.priceDelta);
}
assert.equal(resolveMenuItemPrice({ price: 45, deliveryPrice: 55 }, "store"), 45);
assert.equal(resolveMenuItemPrice({ price: 45, deliveryPrice: 55 }, "delivery"), 55);
assert.equal(resolveMenuItemPrice({ price: 45 }, "delivery"), 45);
assert.equal(resolveOptionPriceDelta({ priceDelta: 10, deliveryPriceDelta: 15 }, "delivery"), 15);
assert.equal(resolveOptionPriceDelta({ priceDelta: 10 }, "delivery"), 10);

const nposSell = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(nposSell, /itemPrice\(/);
assert.match(nposSell, /optionDelta\(/);
assert.doesNotMatch(nposSell, /togglePriceChannel|priceChannelToggle/);

assert.match(read("npos-telltea/app/build.gradle"), /versionCode \d+/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName "/);

// P5 — cut POS menu admin (+ web counter retired)
const posMenuPage = read("src/app/pos/menu/page.tsx");
assert.doesNotMatch(posMenuPage, /PosMenuAdmin/);
assert.match(posMenuPage, /PosWebRetired/);
assert.match(read("src/components/PosWebRetired.tsx"), /telltea-bo\.web\.app\/menu\//);

const e2e = read("scripts/test-pos-menu-e2e.mjs");
assert.match(e2e, /เลิกใช้|nPos|หลังร้าน/);
assert.doesNotMatch(e2e, /ต้องเห็นแท็บกลุ่มตัวเลือก/);

const checklist = read("docs/boh-menu-p3-p5-test-checklist.md");
assert.match(checklist, /P3 — UX/);
assert.match(checklist, /P4 — ช่องทางราคา/);
assert.match(checklist, /P5 — ตัด/);

console.log("OK test-boh-menu-p3-p5");
