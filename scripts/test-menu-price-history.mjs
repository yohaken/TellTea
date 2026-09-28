/**
 * Guard: menu store-price history — trigger diff logic, editor stamp, rules, UI wiring.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const require = createRequire(join(root, "functions", "index.js"));
const { diffItemPrice, diffGroupPrices, resolveEditor, normPrice } = require("./menu-price-history.js");

// normPrice: blank / missing = 0 (no-price option is a real 0)
assert.equal(normPrice(undefined), 0);
assert.equal(normPrice(""), 0);
assert.equal(normPrice(-5), 0);
assert.equal(normPrice("19"), 19);
assert.equal(normPrice(19.999), 20);

// Item diff
assert.deepEqual(diffItemPrice("a", { name: "ปัง", price: 19 }, { name: "ปัง", price: 19, sortOrder: 3 }), []);
assert.deepEqual(diffItemPrice("a", { name: "ปัง", price: 19 }, { name: "ปังใหม่", price: 19 }), []);
assert.deepEqual(diffItemPrice("a", { name: "ปัง", price: 19 }, { name: "ปัง", price: 25 }), [
  { kind: "item", itemId: "a", name: "ปัง", change: "price", from: 19, to: 25 },
]);
assert.equal(diffItemPrice("a", null, { name: "ปัง", price: 19 })[0].change, "created");
assert.equal(diffItemPrice("a", { name: "ปัง", price: 19 }, null)[0].change, "deleted");
assert.equal(diffItemPrice("a", { price: 0 }, { price: undefined }).length, 0);
assert.equal(diffItemPrice("a", { price: 19, deliveryPrice: 25 }, { price: 19, deliveryPrice: 30 }).length, 0);

// Option group diff — by choice id; order / names / priceDeltaMax ignored
const g1 = {
  name: "ท็อปปิ้ง",
  options: [
    { id: "c1", name: "ไข่มุก", priceDelta: 10, sortOrder: 0 },
    { id: "c2", name: "หวานน้อย", sortOrder: 1 },
  ],
};
const reordered = {
  name: "ท็อปปิ้ง",
  options: [
    { id: "c2", name: "หวานน้อยมาก", sortOrder: 0 },
    { id: "c1", name: "ไข่มุก", priceDelta: 10, priceDeltaMax: 20, sortOrder: 1 },
  ],
};
assert.deepEqual(diffGroupPrices("g", g1, reordered), []);

const edited = {
  name: "ท็อปปิ้ง",
  options: [
    { id: "c1", name: "ไข่มุก", priceDelta: 15 },
    { id: "c3", name: "บุก", priceDelta: 10 },
  ],
};
const rows = diffGroupPrices("g", g1, edited);
assert.deepEqual(
  rows.map((r) => [r.choiceId, r.change, r.from, r.to]),
  [
    ["c1", "price", 10, 15],
    ["c3", "added", null, 10],
    ["c2", "removed", 0, null],
  ],
);
assert.ok(diffGroupPrices("g", null, g1).every((r) => r.change === "created"));
assert.ok(diffGroupPrices("g", g1, null).every((r) => r.change === "deleted"));

// Editor stamp only trusted when stamped in the same write
assert.deepEqual(resolveEditor({ updatedAt: 5, priceEditedAt: 5, priceEditedBy: "boh:o@x.com" }), {
  source: "boh",
  by: "o@x.com",
});
assert.deepEqual(resolveEditor({ updatedAt: 5, priceEditedAt: 5, priceEditedBy: "npos:abc" }), {
  source: "npos",
  by: "abc",
});
assert.deepEqual(resolveEditor({ updatedAt: 5, priceEditedAt: 5, priceEditedBy: "pos:uid1" }), {
  source: "npos",
  by: "uid1",
});
assert.deepEqual(resolveEditor({ updatedAt: 9, priceEditedAt: 5, priceEditedBy: "boh:o@x.com" }), {
  source: "script",
  by: "",
});
assert.deepEqual(resolveEditor(null), { source: "script", by: "" });

// Wiring
const indexFn = read("functions/index.js");
assert.match(indexFn, /exports\.onMenuItemPriceWritten/);
assert.match(indexFn, /exports\.onMenuOptionGroupPriceWritten/);

const trigger = read("functions/menu-price-history.js");
assert.doesNotMatch(trigger, /collection\(["']menuItems["']\)|collection\(["']meta["']\)/, "trigger must not write menu docs");

const npos = read("functions/npos-menu-admin.js");
assert.match(npos, /priceEditedBy: `npos:\$\{installId\}`/);

const posMenu = read("src/lib/pos-menu.ts");
const posOptions = read("src/lib/pos-menu-options.ts");
assert.match(posMenu, /menuPriceEditStamp\(/);
assert.match(posOptions, /menuPriceEditStamp\(/);

const rules = read("firestore.rules");
assert.match(rules, /collection != 'menuPriceHistory'/, "catch-all must exclude menuPriceHistory");
assert.match(rules, /'menuPriceHistory'\] && isOwnerEmail\(\)/, "owner-only read");
assert.match(rules, /stockLowAlerts/);

const editor = read("src/components/PosMenuItemEditor.tsx");
assert.match(editor, /<MenuPriceHistory /);
assert.match(editor, /\{showPriceHistory \? \(/);
assert.match(read("src/components/PosMenuAdmin.tsx"), /showPriceHistory=\{isBoh\}/);

const ui = read("src/components/MenuPriceHistory.tsx");
assert.doesNotMatch(ui, /unitCost|stockCosts|มาร์จิ้น|ต้นทุน/);
assert.doesNotMatch(ui, /deliveryPrice|priceDeltaMax/);

console.log("test-menu-price-history: ok");
