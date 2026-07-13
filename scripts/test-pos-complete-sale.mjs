/**
 * Sanity: posCompleteSale transaction must read all docs before any write.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "functions/pos-complete-sale.js"), "utf8");

const txBlock = src.match(/runTransaction\(async \(tx\) => \{([\s\S]*?)\n  \}\);/);
assert.ok(txBlock, "transaction block exists");

const body = txBlock[1];
const firstWrite = body.search(/\btx\.set\(/);
const lastRead = body.lastIndexOf("tx.get(");
assert.ok(firstWrite > -1, "transaction has writes");
assert.ok(lastRead > -1, "transaction has reads");
assert.ok(
  lastRead < firstWrite,
  "Firestore transaction must finish all tx.get() before any tx.set()",
);

console.log("OK pos-complete-sale transaction ordering");
