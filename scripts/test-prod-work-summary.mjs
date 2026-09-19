/**
 * Guard: prod summaries — product overview + worker×product with MoM diff
 */
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

function pieceQty(raw) {
  return Math.max(0, Math.round(Number(raw) || 0));
}

function qtyByProduct(entries) {
  const map = new Map();
  for (const row of entries) {
    const qty = pieceQty(row.qtyProduced);
    if (qty <= 0) continue;
    const productId = String(row.productId || "").trim() || "_";
    const productName = String(row.productName || "").trim() || "—";
    const prev = map.get(productId);
    if (prev) prev.qty += qty;
    else map.set(productId, { productName, qty });
  }
  return map;
}

function buildProdProductCompareSummary(nowEntries, prevEntries) {
  const nowMap = qtyByProduct(nowEntries);
  const prevMap = qtyByProduct(prevEntries);
  const ids = new Set([...nowMap.keys(), ...prevMap.keys()]);
  const rows = [];
  let totalPrev = 0;
  let totalNow = 0;
  for (const productId of ids) {
    const now = nowMap.get(productId);
    const prev = prevMap.get(productId);
    const qtyPrev = prev?.qty || 0;
    const qtyNow = now?.qty || 0;
    if (qtyPrev <= 0 && qtyNow <= 0) continue;
    totalPrev += qtyPrev;
    totalNow += qtyNow;
    rows.push({
      productId,
      productName: now?.productName || prev?.productName || "—",
      qtyPrev,
      qtyNow,
      diff: qtyNow - qtyPrev,
    });
  }
  rows.sort((a, b) => b.qtyNow - a.qtyNow);
  return { rows, totalPrev, totalNow, totalDiff: totalNow - totalPrev };
}

const now = [
  { productId: "p1", productName: "ครัวซอง", qtyProduced: 30, workerIds: ["a"], workerNames: ["แนน"] },
  { productId: "p2", productName: "คุกกี้", qtyProduced: 10, workerIds: ["a", "b"], workerNames: ["แนน", "โอ"] },
];
const prev = [
  { productId: "p1", productName: "ครัวซอง", qtyProduced: 20, workerIds: ["a"], workerNames: ["แนน"] },
  { productId: "p2", productName: "คุกกี้", qtyProduced: 15, workerIds: ["b"], workerNames: ["โอ"] },
];

const product = buildProdProductCompareSummary(now, prev);
assert.equal(product.totalPrev, 35);
assert.equal(product.totalNow, 40);
assert.equal(product.totalDiff, 5);
const croissants = product.rows.find((r) => r.productId === "p1");
assert.equal(croissants?.qtyPrev, 20);
assert.equal(croissants?.qtyNow, 30);
assert.equal(croissants?.diff, 10);

assert.ok(existsSync(join(root, "src/lib/prod-work-summary.ts")));
assert.ok(existsSync(join(root, "src/components/ProdWorkSummaryStrip.tsx")));
assert.match(read("src/lib/prod-work-summary.ts"), /buildProdProductCompareSummary/);
assert.match(read("src/lib/prod-work-summary.ts"), /groupProdWorkerCompareRows/);
assert.match(read("src/components/ProdWorkSummaryStrip.tsx"), /prod-work-summary-parent/);
assert.match(read("src/components/ProdWorkSummaryStrip.tsx"), /prod-work-summary-child/);
assert.match(read("src/app/globals.css"), /\.prod-work-summary-child-label/);
assert.match(read("src/lib/prod-work-summary.ts"), /shiftMonthInput/);
assert.match(read("src/components/ProdWorkSummaryStrip.tsx"), /ProdProductSummaryStrip/);
assert.match(read("src/components/ProdWorkSummaryStrip.tsx"), /ProdWorkerSummaryStrip/);
assert.match(read("src/components/ProdWorkSummaryStrip.tsx"), /เดือนก่อน/);
assert.match(read("src/components/ProdWorkSummaryStrip.tsx"), /ส่วนต่าง/);
assert.match(read("src/app/production/page.tsx"), /ProdProductSummaryStrip/);
assert.match(read("src/app/production/page.tsx"), /production-page-head/);
assert.match(read("src/app/production/page.tsx"), /prevEntries/);
assert.match(read("src/app/globals.css"), /\.prod-work-summary-diff/);
assert.match(read("src/app/globals.css"), /\.production-page-head/);
assert.match(read("src/app/globals.css"), /white-space:\s*normal/);
assert.match(
  read("src/app/globals.css"),
  /\.prod-work-summary-duo \{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/,
);

console.log("OK test-prod-work-summary");
