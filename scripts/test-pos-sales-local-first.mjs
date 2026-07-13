/**
 * Local-first POS sale tests (mirrors src/lib/pos-sales.ts + pos-sync-utils.ts).
 */
import assert from "node:assert/strict";
import fs from "node:fs";

function computeSessionPendingOverlay(sessionId, bills) {
  const pending = bills.filter((b) => b.sessionId === sessionId && b.status === "pending");
  const extraTotalSales = pending.reduce((sum, b) => sum + b.total, 0);
  return {
    extraSaleCount: pending.length,
    extraTotalSales: Math.round(extraTotalSales * 100) / 100,
  };
}

const overlay = computeSessionPendingOverlay("sess-a", [
  { sessionId: "sess-a", total: 50, status: "pending" },
  { sessionId: "sess-a", total: 30, status: "pending" },
  { sessionId: "sess-b", total: 99, status: "pending" },
  { sessionId: "sess-a", total: 10, status: "failed" },
]);
assert.equal(overlay.extraSaleCount, 2);
assert.equal(overlay.extraTotalSales, 80);

const salesSrc = fs.readFileSync(new URL("../src/lib/pos-sales.ts", import.meta.url), "utf8");
assert.doesNotMatch(salesSrc, /invokePosCompleteSale/);
assert.doesNotMatch(salesSrc, /isBrowserOnline/);
assert.match(salesSrc, /stagePendingSale/);
assert.match(salesSrc, /recordSaleInstant/);
assert.match(salesSrc, /void runPosSyncFlush\(\)/);
assert.match(salesSrc, /persistSaleInBackground/);
assert.doesNotMatch(salesSrc, /export async function completeCashSale/);
assert.doesNotMatch(salesSrc, /export async function completePromptPaySale/);

const syncTypesSrc = fs.readFileSync(new URL("../src/lib/pos-sync-types.ts", import.meta.url), "utf8");
assert.match(syncTypesSrc, /sessionId: string/);

const syncSrc = fs.readFileSync(new URL("../src/lib/pos-sync.ts", import.meta.url), "utf8");
assert.match(syncSrc, /sessionId: entry\.payload\.sessionId/);

const sellSrc = fs.readFileSync(new URL("../src/components/PosSellView.tsx", import.meta.url), "utf8");
assert.match(sellSrc, /computeSessionPendingOverlay/);
assert.match(sellSrc, /pendingBills/);
assert.doesNotMatch(sellSrc, /setBusy\(true\)/);
assert.match(sellSrc, /บันทึกแล้ว/);

const utilsSrc = fs.readFileSync(new URL("../src/lib/pos-sync-utils.ts", import.meta.url), "utf8");
assert.match(utilsSrc, /computeSessionPendingOverlay/);

const cfSrc = fs.readFileSync(new URL("../functions/pos-complete-sale.js", import.meta.url), "utf8");
assert.match(cfSrc, /if \(txResult\.replay\)/);
assert.match(cfSrc, /posSaleMutations/);

console.log("OK pos-sales-local-first");
