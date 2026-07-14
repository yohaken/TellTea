/**
 * POS 51 — category order: local-first paint, then always adopt latest load.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const preload = read("src/lib/pos-menu-preload.ts");
const menu = read("src/lib/pos-menu.ts");
const ver = read("src/lib/pos-version.ts");

assert.match(ver, /POS_BUILD\s*=\s*51\b/);

assert.match(preload, /pendingOrderUntil/);
assert.match(preload, /applyPendingOrder/);
assert.match(preload, /releasePendingIfRemoteCaughtUp/);
assert.match(preload, /publishLocalMenuOrder/);
assert.match(preload, /ยึดลำดับจากโหลดล่าสุด/);
assert.doesNotMatch(preload, /localOrderHoldUntil/);
assert.doesNotMatch(preload, /\bapplyHeldOrder\b/);

// เทียบ incoming ดิบ — ไม่เทียบหลัง apply (บั๊กเดิม)
assert.match(
  preload,
  /categoryOrderKey\(categories\)\s*===\s*categoryOrderKey\(pendingCategories\)/,
);

// bundle ไม่เขียนแคชเอง — preload เป็นคน mirror
assert.doesNotMatch(menu, /function publish[\s\S]{0,200}savePosMenuCache/);
assert.match(menu, /ไม่เขียน localStorage ที่นี่/);
assert.match(menu, /includeMetadataChanges:\s*true/);

console.log("test-pos-category-order-sync: ok");
