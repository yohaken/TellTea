/**
 * Stock catalog lives on /stock (owner tab), not under อื่นๆ → settings.
 * CSV import UI removed — manage items manually.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const stockPage = read("src/app/stock/page.tsx");
const settings = read("src/app/settings/page.tsx");
const catalog = read("src/components/StockCatalogSetup.tsx");
const version = read("src/lib/version.ts");

assert.match(version, /APP_BUILD = 262/);
assert.match(stockPage, /StockCatalogSetup/);
assert.match(stockPage, /รายการวัตถุดิบ/);
assert.match(stockPage, /stock-owner-tabs/);
assert.match(stockPage, /ownerView === "catalog"/);
assert.doesNotMatch(settings, /StockCatalogSetup/);
assert.match(settings, /คลังอยู่หน้า คลัง/);
assert.match(catalog, /adjustStockQty/);
assert.match(catalog, /stock-qty-stepper/);
assert.match(catalog, /ลบ「/);
assert.match(catalog, /รายการวัตถุดิบ \(\{items\.length\}\)/);
assert.doesNotMatch(catalog, /นำเข้า CSV|stock-import|parseStockCsv|importStockCsv/);
assert.doesNotMatch(stockPage, /นำเข้า CSV/);

console.log("OK test-stock-catalog-owner");
