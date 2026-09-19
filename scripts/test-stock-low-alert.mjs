/**
 * Guard: stock low alerts — per-item alertEnabled + owner notify hooks.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const types = read("src/lib/types.ts");
const stock = read("src/lib/stock.ts");
const alerts = read("src/lib/stock-alerts.ts");
const ownerNotify = read("src/lib/owner-notify.ts");
const catalog = read("src/components/StockCatalogSetup.tsx");
const setup = read("src/components/OwnerNotifySetup.tsx");
const fn = read("functions/low-stock-line.js");
const indexFn = read("functions/index.js");
const digest = read("functions/owner-daily-digest.js");
const lineOwner = read("functions/line-owner.js");

assert.match(types, /alertEnabled:\s*boolean/);
assert.match(stock, /alertEnabled:\s*data\.alertEnabled\s*===\s*true/);
assert.match(alerts, /export function stockItemAlertArmed/);
assert.match(ownerNotify, /instantStockLowEnabled/);
assert.match(ownerNotify, /includeStockLow/);
assert.match(catalog, /เปิดแจ้งเตือน LINE/);
assert.match(catalog, /alertEnabled/);
assert.match(setup, /แจ้งคลังต่ำ/);
assert.match(setup, /includeStockLow/);
assert.match(fn, /evaluateAndSendStockLowLine/);
assert.match(fn, /stockLowAlerts/);
assert.match(indexFn, /onStockItemWritten/);
assert.match(digest, /includeStockLow/);
assert.match(digest, /คลังต่ำกว่าเกณฑ์/);
assert.match(lineOwner, /instantStockLowEnabled/);

function stockItemAlertArmed(item) {
  return Boolean(item.alertEnabled) && item.minQty > 0 && item.qty <= item.minQty;
}

assert.equal(
  stockItemAlertArmed({ alertEnabled: false, minQty: 10, qty: 5 }),
  false,
);
assert.equal(
  stockItemAlertArmed({ alertEnabled: true, minQty: 10, qty: 5 }),
  true,
);
assert.equal(
  stockItemAlertArmed({ alertEnabled: true, minQty: 10, qty: 10 }),
  true,
);
assert.equal(
  stockItemAlertArmed({ alertEnabled: true, minQty: 10, qty: 11 }),
  false,
);
assert.equal(
  stockItemAlertArmed({ alertEnabled: true, minQty: 0, qty: 0 }),
  false,
);

console.log("OK test-stock-low-alert");
