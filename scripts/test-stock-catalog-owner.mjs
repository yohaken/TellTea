/**
 * Stock item settings: tap name → slim popup · + below table · icon from name.
 * Ahead rounds = 2. No separate catalog tab.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const stockPage = read("src/app/stock/page.tsx");
const settings = read("src/app/settings/page.tsx");
const hist = read("src/lib/stock-history.ts");
const icons = read("src/lib/stock-icons.ts");
const version = read("src/lib/version.ts");

assert.match(version, /APP_BUILD\s*=\s*\d+/);
assert.match(stockPage, /StockItemSlimModal/);
assert.match(stockPage, /guessStockIconId/);
assert.match(stockPage, /stock-history-add-bar/);
assert.match(
  stockPage,
  /\{isOwner \? \(\s*<div className="stock-history-add-bar"/,
);
assert.match(stockPage, /\{editTarget && isOwner \?/);
assert.match(stockPage, /onOpenSettings/);
assert.match(hist, /upcomingStockRounds\(2/);
assert.doesNotMatch(stockPage, /ownerView === "catalog"/);
assert.doesNotMatch(stockPage, /StockCatalogSetup/);
assert.doesNotMatch(stockPage, /stock-history-item-name-input/);
assert.doesNotMatch(settings, /StockCatalogSetup/);
assert.match(settings, /คลังอยู่หน้า คลัง/);
assert.match(icons, /STOCK_ICON_OPTIONS/);
assert.match(icons, /guessStockIconId/);
assert.match(icons, /ShoppingBag/);
assert.match(icons, /Disc3/);
assert.match(icons, /Cylinder/);
assert.match(stockPage, /เปิดแจ้งเตือน LINE เมื่อคงเหลือ/);
assert.match(stockPage, /alertEnabled/);
assert.match(icons, /powder/);
assert.doesNotMatch(icons, /Pipette/);
assert.doesNotMatch(icons, /Candy/);
assert.doesNotMatch(icons, /Scroll/);

// Mirror guess rules — IC = powder, bags, seal roll, straw
function guess(name) {
  const n = name.trim().toLowerCase();
  if (/\bic\.?/.test(n) || n.startsWith("ic") || /ผงห่อ|ผง /.test(n)) return "powder";
  if (/หลอด|straw/.test(n)) return "straw";
  if (/ฝา|ซีล|lid|ม้วน/.test(n)) return "lid";
  if (/ถุง.*เย็น|เก็บความเย็น|cooler/.test(n)) return "cold";
  if (/เบเกอ|ถุงกระดาษ|bakery/.test(n)) return "bakery";
  if (/ถุง|bag/.test(n)) return "bag";
  if (/โคน|cone/.test(n)) return "ice";
  return "bag";
}
assert.equal(guess("IC.นม"), "powder");
assert.equal(guess("IC.รสอื่นๆ"), "powder");
assert.equal(guess("ถุงกระดาษเบเกอรี่"), "bakery");
assert.equal(guess("ถุงเก็บความเย็น"), "cold");
assert.equal(guess("ฝาซีล"), "lid");
assert.equal(guess("หลอดใหญ่"), "straw");
assert.equal(guess("โคน S"), "ice");

console.log("OK test-stock-catalog-owner");
