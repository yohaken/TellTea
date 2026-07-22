#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeFoodstoryRaw } from "./lib/foodstory-normalize.mjs";
import { planFoodstoryApply } from "./foodstory-menu-apply.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(__dir, "data/foodstory-snapshots/fixture-raw.json"), "utf8"),
);
const snapshot = normalizeFoodstoryRaw(fixture);

const existing = {
  categories: [
    {
      id: "old_wongnai_cat",
      name: "ของเก่า",
      sortOrder: 1,
      active: true,
    },
    {
      id: "manual_cat",
      name: "มือ",
      source: "manual",
      sortOrder: 9,
      active: true,
    },
  ],
  optionGroups: [],
  items: [
    {
      id: "old_item",
      name: "เมนูเก่า",
      categoryId: "old_wongnai_cat",
      price: 10,
      sortOrder: 1,
      active: true,
    },
    {
      id: "manual_item",
      name: "เมนูมือ",
      source: "manual",
      categoryId: "manual_cat",
      price: 99,
      sortOrder: 1,
      active: true,
      recommended: true,
    },
  ],
};

const { plan } = await planFoodstoryApply(snapshot, existing);

assert.equal(plan.categories.create.length, 2);
assert.equal(plan.optionGroups.create.length, 2);
assert.equal(plan.items.create.length, 2);
assert.equal(plan.orphans.categories.length, 1);
assert.equal(plan.orphans.items.length, 1);
assert.equal(plan.preservedManual.categories, 1);
assert.equal(plan.preservedManual.items, 1);
assert.equal(plan.categories.delete.length, 0);
assert.equal(plan.items.delete.length, 0);

// second apply: update existing foodstory docs, delete missing
const existing2 = {
  categories: [
    {
      id: "fs_cat_10",
      name: "ชา",
      externalSource: "foodstory",
      externalId: "10",
      source: "foodstory",
      sortOrder: 1000,
      active: true,
    },
    {
      id: "fs_cat_gone",
      name: "หาย",
      externalSource: "foodstory",
      externalId: "999",
      source: "foodstory",
      sortOrder: 1,
      active: true,
    },
  ],
  optionGroups: [
    {
      id: "fs_opt_501",
      name: "ระดับหวาน",
      externalSource: "foodstory",
      externalId: "501",
      source: "foodstory",
      required: true,
      selectionType: "single",
      options: [{ id: "fs_c_901", externalId: "901", name: "หวานปกติ", priceDelta: 0, sortOrder: 100, active: true }],
      sortOrder: 1,
      active: true,
    },
  ],
  items: [
    {
      id: "fs_item_101",
      name: "ชาเย็นเก่า",
      externalSource: "foodstory",
      externalId: "101",
      source: "foodstory",
      categoryId: "fs_cat_10",
      price: 40,
      sortOrder: 100,
      active: true,
      recommended: true,
      visibleOnPos: true,
    },
    {
      id: "fs_item_gone",
      name: "โกโก้",
      externalSource: "foodstory",
      externalId: "102x",
      source: "foodstory",
      categoryId: "fs_cat_10",
      price: 50,
      sortOrder: 1,
      active: true,
    },
  ],
};

const { plan: plan2 } = await planFoodstoryApply(snapshot, existing2);
assert.ok(plan2.categories.update.some((c) => c.ext === "10"));
assert.ok(plan2.categories.create.some((c) => c.ext === "20"));
assert.ok(plan2.categories.delete.some((c) => c.ext === "999"));
assert.ok(plan2.items.update.some((i) => i.ext === "101" && i.data.price === 45 && i.data.recommended === true));
assert.ok(plan2.items.delete.some((i) => i.ext === "102x"));
assert.ok(plan2.items.create.some((i) => i.ext === "102"));

console.log("test-foodstory-menu-apply: ok", {
  firstCreateItems: plan.items.create.length,
  secondDeleteItems: plan2.items.delete.length,
});
