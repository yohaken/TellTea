/**
 * Guard: stock cost history · aliases · unit convert · owner-only rules
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const costs = read("src/lib/stock-costs.ts");
assert.match(costs, /export type StockCostDoc/);
assert.match(costs, /sourceLedgerId/);
assert.match(costs, /sourceBillLine/);
assert.match(costs, /stockCostHistory/);
assert.match(costs, /listStockCostHistory/);
assert.match(costs, /subscribeStockCostMetaMap/);
assert.match(costs, /skipIfUnchanged/);
assert.match(costs, /export function convertUnitCost/);
assert.match(costs, /export function stockUnitsCompatible/);

const stock = read("src/lib/stock.ts");
assert.match(stock, /aliases/);
assert.match(stock, /normalizeStockMatchKey/);
assert.match(stock, /findStockByNameOrAlias/);
assert.match(stock, /addStockAliasIfNew/);
assert.match(stock, /rules: stockCosts = isOwnerEmail/);

const rules = read("firestore.rules");
assert.match(rules, /match \/stockCosts\/\{itemId\}[\s\S]*allow read, write: if isOwnerEmail/);
assert.match(rules, /match \/stockCostHistory\/\{histId\}[\s\S]*allow read, write: if isOwnerEmail/);
assert.match(rules, /match \/evidencePhotos\/\{photoId\}/);
assert.match(rules, /allow list, delete: if isOwnerEmail/);
assert.match(rules, /collection != 'stockCosts'/);
assert.match(rules, /collection != 'stockCostHistory'/);
assert.match(rules, /collection != 'evidencePhotos'/);

const page = read("src/app/stock/page.tsx");
assert.match(page, /stock-skip-stale-tag/);
assert.match(page, /listStockCostHistory/);
assert.match(page, /stock-item-slim-history/);
assert.match(page, /stock-item-slim-aliases/);

const css = read("src/app/globals.css");
assert.match(css, /\.stock-page \.check-filter-pill/);
assert.match(css, /\.stock-page \.stock-history-add-btn/);
assert.match(css, /\.bakery-sop-ing-missing/);
assert.match(css, /\.bakery-sop-ing-ai/);
assert.match(css, /\.bakery-sop-ing-sheet/);
assert.match(css, /\.bakery-sop-ing-table[\s\S]*table-layout: fixed/);

const sopPage = read("src/app/bakery-sop/page.tsx");
assert.match(sopPage, /className="sheet-wrap bakery-sop-ing-sheet"/);
assert.match(sopPage, /bakery-sop-ing-table/);
assert.doesNotMatch(sopPage, /bakery-sop-ing-sheet sheet-bleed/);
assert.doesNotMatch(sopPage, /sheet-bleed"[\s\S]{0,80}bakery-sop-ing-table/);

const version = read("src/lib/version.ts");
assert.ok(Number(version.match(/APP_BUILD = (\d+)/)[1]) >= 1026);

// Mirror convertUnitCost / compatible (keep in sync with stock-costs.ts)
function round2(n) {
  return Math.round(n * 100) / 100;
}
function stockUnitsCompatible(a, b) {
  const norm = (u) =>
    String(u || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "");
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return true;
  if (x === y) return true;
  const mass = new Set(["ก.", "ก", "g", "กรัม", "kg", "กก.", "กก", "กิโล"]);
  const vol = new Set(["มล.", "มล", "ml", "ล.", "ล", "ลิตร", "l"]);
  const piece = new Set(["ชิ้น", "ถุง", "ซอง", "อัน", "ลูก", "ฟอง", "โคน"]);
  return (mass.has(x) && mass.has(y)) || (vol.has(x) && vol.has(y)) || (piece.has(x) && piece.has(y));
}
function convertUnitCost(unitCost, fromUnit, toUnit) {
  if (!(unitCost > 0)) return null;
  if (!stockUnitsCompatible(fromUnit, toUnit)) return null;
  const norm = (u) =>
    String(u || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "");
  const from = norm(fromUnit);
  const to = norm(toUnit);
  if (from === to) return round2(unitCost);
  if (
    (from === "กก." || from === "กก" || from === "kg" || from === "กิโล") &&
    (to === "ก." || to === "ก" || to === "g" || to === "กรัม")
  ) {
    return Math.round((unitCost / 1000) * 100000) / 100000;
  }
  if (
    (from === "ก." || from === "ก" || from === "g" || from === "กรัม") &&
    (to === "กก." || to === "กก" || to === "kg" || to === "กิโล")
  ) {
    return round2(unitCost * 1000);
  }
  return round2(unitCost);
}

assert.equal(stockUnitsCompatible("กก.", "ก."), true);
assert.equal(stockUnitsCompatible("กก.", "ชิ้น"), false);
assert.equal(convertUnitCost(43, "กก.", "ก."), 0.043);
assert.equal(convertUnitCost(0.043, "ก.", "กก."), 43);

function normalizeStockMatchKey(raw) {
  return String(raw || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\u0E00-\u0E7fa-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
assert.equal(
  normalizeStockMatchKey("แป้งสาลี (บัวแดงพิเศษ)"),
  normalizeStockMatchKey("แป้งสาลี"),
);

assert.match(css, /stock-skip-th-name[\s\S]*text-align: left !important/);
assert.match(css, /stock-skip-name[\s\S]*text-align: left !important/);

console.log("OK test-stock-cost-history");


