import assert from "node:assert/strict";
import {
  OWNER_QUICK_CATALOG,
  OWNER_QUICK_KEYS,
  OWNER_QUICK_MAX,
  abbrForOwnerQuickKey,
  normalizeOwnerQuickAbbr,
  normalizeOwnerQuickAbbrs,
  normalizeOwnerQuickKeys,
  resolveOwnerQuickItems,
  setOwnerQuickAbbr,
  setupOwnerQuickListOrder,
  toggleOwnerQuickKey,
} from "../src/lib/owner-quick-dock";

assert.equal(OWNER_QUICK_MAX, 10);
assert.ok(OWNER_QUICK_KEYS.includes("businessNotes"));
assert.ok(OWNER_QUICK_KEYS.includes("production"));
assert.ok(OWNER_QUICK_KEYS.includes("capital"));
assert.ok(OWNER_QUICK_KEYS.length >= 18);

assert.equal(normalizeOwnerQuickAbbr(" เจ "), "เจ");
assert.equal(normalizeOwnerQuickAbbr("ABCDEF"), "ABCD");
assert.equal(normalizeOwnerQuickAbbr(""), "");

const abbrs = normalizeOwnerQuickAbbrs({
  pnl: "กำ",
  ownerBooks: "เจ", // same as default — drop
  junk: "x",
});
assert.equal(abbrs.pnl, "กำ");
assert.equal(abbrs.ownerBooks, undefined);

assert.equal(abbrForOwnerQuickKey("pnl", abbrs), "กำ");
assert.equal(abbrForOwnerQuickKey("vatSales", abbrs), OWNER_QUICK_CATALOG.vatSales.abbr);

const nextAbbr = setOwnerQuickAbbr(abbrs, "staff", "คน");
assert.equal(nextAbbr.staff, "คน");
const cleared = setOwnerQuickAbbr(nextAbbr, "staff", "พนง");
assert.equal(cleared.staff, undefined);

const keys = normalizeOwnerQuickKeys(["pnl", "bogus", "ledger", "pnl"]);
assert.deepEqual(keys, ["pnl", "ledger"]);

const toggled = toggleOwnerQuickKey(keys, "menu", true);
assert.ok(toggled.includes("menu"));

const order = setupOwnerQuickListOrder(toggled);
assert.equal(order[0], "pnl");
assert.ok(order.includes("businessNotes"));

const items = resolveOwnerQuickItems(["pnl"], { pnl: "กข" });
assert.equal(items[0].abbr, "กข");
assert.equal(items[0].href, "/pnl/");

console.log("test-owner-quick-dock-lib: ok");
