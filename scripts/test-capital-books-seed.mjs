/**
 * Assert capital seed rows + summary math (no Firebase).
 */
import assert from "node:assert/strict";

const ROWS = [
  { description: "ลงทุน", amountIn: 450_000, amountOut: 0 },
  { description: "คืนทุน", amountIn: 0, amountOut: 300_000 },
  { description: "คืนทุน", amountIn: 0, amountOut: 100_000 },
  { description: "คืนทุน", amountIn: 0, amountOut: 100_000 },
  { description: "คืนทุน", amountIn: 0, amountOut: 100_000 },
  { description: "คืนทุน", amountIn: 0, amountOut: 100_000 },
  { description: "คืนทุน", amountIn: 0, amountOut: 500_000 },
  { description: "คืนทุน", amountIn: 0, amountOut: 160_000 },
  { description: "คืนทุน", amountIn: 0, amountOut: 100_000 },
  { description: "คืนทุน", amountIn: 0, amountOut: 100_000 },
];

const totalIn = ROWS.reduce((s, r) => s + r.amountIn, 0);
const totalOut = ROWS.reduce((s, r) => s + r.amountOut, 0);
const balance = totalIn - totalOut;

assert.equal(ROWS.length, 10);
assert.equal(totalIn, 450_000);
assert.equal(totalOut, 1_560_000);
assert.equal(balance, -1_110_000);
assert.equal(ROWS.filter((r) => r.amountIn > 0).length, 1);
assert.equal(ROWS.filter((r) => r.amountOut > 0).length, 9);

console.log("ok capital-books seed math", { totalIn, totalOut, balance });
