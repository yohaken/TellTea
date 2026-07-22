#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractList,
  imageUrlFromKey,
} from "./lib/foodstory-api.mjs";
import {
  normalizeFoodstoryRaw,
  summarizeSnapshot,
  validateSnapshot,
} from "./lib/foodstory-normalize.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(__dir, "data/foodstory-snapshots/fixture-raw.json"), "utf8"),
);

assert.equal(imageUrlFromKey("restaurant/a.png"), "https://images.foodstory.co/restaurant/a.png");
assert.equal(imageUrlFromKey("https://cdn.example/x.png"), "https://cdn.example/x.png");
assert.deepEqual(extractList({ data: [{ a: 1 }] }), [{ a: 1 }]);
assert.deepEqual(extractList({ menu_list: [1, 2] }), [1, 2]);

const snap = normalizeFoodstoryRaw(fixture);
const summary = summarizeSnapshot(snap);
const issues = validateSnapshot(snap);

assert.equal(snap.categories.length, 2);
assert.equal(snap.items.length, 2);
assert.equal(snap.optionGroups.length, 2);
assert.equal(summary.itemsWithOptions, 2);
assert.equal(issues.length, 0);

const cha = snap.items.find((i) => i.name === "ชาเย็น");
assert.ok(cha);
assert.equal(cha.price, 45);
assert.equal(cha.categoryExternalId, "10");
assert.deepEqual(cha.optionGroupExternalIds, ["501", "502"]);
assert.match(cha.imageUrl, /images\.foodstory\.co\/restaurant\/demo\/cha-yen\.png/);

const sweet = snap.optionGroups.find((g) => g.externalId === "501");
assert.equal(sweet.required, true);
assert.equal(sweet.selectionType, "single");
assert.equal(sweet.options.length, 2);

const topping = snap.optionGroups.find((g) => g.externalId === "502");
assert.equal(topping.required, false);
assert.equal(topping.selectionType, "multi");
assert.equal(topping.maxSelect, 3);
assert.equal(topping.options.find((o) => o.name === "ไข่มุก").priceDelta, 10);

// missing option link should surface validation issue
const broken = normalizeFoodstoryRaw({
  ...fixture,
  menuDetails: { 101: { option_list: [{ option_id: 999, choose_flag: 1 }] } },
});
const brokenIssues = validateSnapshot(broken);
assert.ok(brokenIssues.some((x) => x.includes("999")));

console.log("test-foodstory-menu-capture: ok", summary);
