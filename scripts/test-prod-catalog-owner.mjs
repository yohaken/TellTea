/**
 * Prod product catalog lives on /production (owner tab), not settings.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const settings = read("src/app/settings/page.tsx");
const production = read("src/app/production/page.tsx");
const catalog = read("src/components/ProdCatalogSetup.tsx");
const ratePanel = read("src/components/RateSchedulePanel.tsx");
const more = read("src/app/more/page.tsx");
const version = read("src/lib/version.ts");

assert.match(version, /APP_BUILD = 265/);
assert.doesNotMatch(settings, /ProdCatalogSetup|listProdProducts|seedProdCatalog/);
assert.match(settings, /สินค้าผลิตอยู่หน้า ผลิต/);
assert.match(production, /ProdCatalogSetup/);
assert.match(production, /ownerView === "catalog"/);
assert.match(production, /สินค้า \/ เรท/);
assert.match(catalog, /prod-catalog-panel/);
assert.match(catalog, /เพิ่มสินค้า/);
assert.match(ratePanel, /ผลิต → สินค้า \/ เรท/);
assert.match(more, /สินค้าผลิตอยู่หน้าผลิต/);

console.log("OK test-prod-catalog-owner");
