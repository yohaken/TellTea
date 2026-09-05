/**
 * Gate test: Menu Sales Volume integration
 * Verifies library, PosMenuChannelPriceHub wiring, and Firestore data.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { doc, getDoc } from "firebase/firestore";
import { getSeedDb } from "./lib/pos-firebase-seed.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const lib = read("src/lib/menu-sales-volume.ts");
const hub = read("src/components/PosMenuChannelPriceHub.tsx");
const css = read("src/app/globals.css");
const scraper = read("scripts/pull-platform-sales-quantities.mjs");

// 1. Library checks
assert.match(lib, /export type SalesPeriod = "1m" \| "3m" \| "6m"/);
assert.match(lib, /export const SALES_PERIODS: SalesPeriod\[\] = \["1m", "3m", "6m"\]/);
assert.match(lib, /export const SALES_PERIOD_LABELS/);
assert.match(lib, /export function emptySalesVolumeStore/);
assert.match(lib, /export function normalizeSalesVolumeStore/);
assert.match(lib, /export function subscribeSalesVolumeStore/);
assert.match(lib, /export async function saveSalesVolumeStore/);

// 2. Hub component checks
assert.match(hub, /isSalesCol/);
assert.match(hub, /sales_store/);
assert.match(hub, /sales_grab/);
assert.match(hub, /sales_lineman/);
assert.match(hub, /sales_shopee/);
assert.match(hub, /sales_total/);
assert.match(hub, /mph-chip-sales/);
assert.match(hub, /mph-sales-toggles/);
assert.match(hub, /SHOW_SALES_KEY/);
assert.match(hub, /persistShowSales/);
assert.match(hub, /getItem\(SHOW_SALES_KEY\) === "1"/);
assert.match(hub, /showSalesSyncModal/);
assert.match(hub, /renderSalesCell/);
assert.match(hub, /renderOptSalesCell/);
assert.match(hub, /subscribeSalesVolumeStore/);
assert.match(hub, /activePeriodSales/);

// 3. CSS checks
assert.match(css, /\.mph-sales-toggles/);
assert.match(css, /\.mph-chip-sales/);
assert.match(css, /\.mph-th\.is-sales/);
assert.match(css, /\.mph-td\.is-sales/);
assert.match(css, /\.mph-sales-cell/);
assert.match(css, /\.mph-sales-qty/);

// 4. Scraper script checks
assert.match(scraper, /merchant\.grab\.com/);
assert.match(scraper, /merchant\.wongnai\.com/);
assert.match(scraper, /partner\.shopee/);
assert.match(scraper, /menuPriceHub.*salesVolume/);
assert.match(scraper, /bestMatchByName/);

// 5. Live Firestore data checks
console.log("Checking Firestore document menuPriceHub/salesVolume...");
const db = await getSeedDb();
const snap = await getDoc(doc(db, "menuPriceHub", "salesVolume"));
assert.ok(snap.exists(), "menuPriceHub/salesVolume document must exist in Firestore");

const data = snap.data();
assert.ok(data.periods, "Document must have periods");
assert.ok(data.periods["1m"], "Period 1m must exist");
assert.ok(data.periods["3m"], "Period 3m must exist");
assert.ok(data.periods["6m"], "Period 6m must exist");

const p1 = data.periods["1m"];
assert.ok(p1.channels.pos.available, "POS channel must be available");
assert.ok(p1.channels.pos.totalQty > 0, "POS totalQty must be > 0");
assert.ok(p1.channels.grab.totalQty > 0, "Grab totalQty must be > 0");
assert.ok(p1.channels.lineman.totalQty > 0, "LINE MAN totalQty must be > 0");
assert.equal(p1.channels.shopee.available, false, "Shopee channel should be unavailable with note");
assert.ok(Object.keys(p1.byItemId).length > 50, "Should have > 50 menu items in 1m summary");

console.log(`OK: Firestore salesVolume verified!`);
console.log(`  1m: POS ${p1.channels.pos.totalQty} items · Grab ${p1.channels.grab.totalQty} items · LM ${p1.channels.lineman.totalQty} items`);
console.log("OK test-menu-sales-volume passed successfully.");
process.exit(0);
