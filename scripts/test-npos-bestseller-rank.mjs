/**
 * Bestseller rank R0–R5 wiring gate + pure compute/sort helpers.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const require = createRequire(import.meta.url);

assert.match(read("src/lib/version.ts"), /APP_BUILD = 249/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+40/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.17"/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 69/);

assert.ok(existsSync(join(root, "docs/npos-bestseller-rank-checklist.md")));
const doc = read("docs/npos-bestseller-rank-checklist.md");
assert.match(doc, /fix/);
assert.match(doc, /bestsellers/);
assert.match(doc, /7\s*วัน/);
assert.match(doc, /14\s*วัน/);

const remaining = read("docs/npos-remaining-checklist.md");
assert.match(remaining, /npos-bestseller-rank-checklist/);

// Shared TS helpers compiled? Use dynamic import of source via node --experimental?
// Gate on source presence + CF module instead.
assert.ok(existsSync(join(root, "src/lib/pos-bestseller-rank.ts")));
assert.ok(existsSync(join(root, "src/lib/pos-bestseller-local.ts")));
assert.ok(existsSync(join(root, "src/lib/pos-menu-rank-store.ts")));
assert.ok(existsSync(join(root, "functions/pos-menu-rank.js")));

const rankLib = require(join(root, "functions/pos-menu-rank-core.js"));
assert.equal(typeof rankLib.applyBestsellersOrder, "function");

const cats = [
  { id: "a", name: "A", sortOrder: 1000 },
  { id: "b", name: "B", sortOrder: 2000 },
];
const items = [
  { id: "i1", name: "I1", sortOrder: 100, categoryId: "a" },
  { id: "i2", name: "I2", sortOrder: 200, categoryId: "a" },
];
const ordered = rankLib.applyBestsellersOrder(cats, items, {
  categories: [
    { categoryId: "b", score: 10, rank: 1 },
    { categoryId: "a", score: 1, rank: 2 },
  ],
  items: [
    { menuItemId: "i2", categoryId: "a", qty: 5, score: 5, rank: 1 },
    { menuItemId: "i1", categoryId: "a", qty: 1, score: 1, rank: 2 },
  ],
});
assert.equal(ordered.categories[0].id, "b");
assert.equal(ordered.items[0].id, "i2");

const settings = read("src/lib/pos-settings.ts");
assert.match(settings, /menuArrangeMode/);
assert.match(settings, /bestsellerWindowDays/);

const biz = read("src/components/PosBusinessSettingsView.tsx");
assert.match(biz, /จัดเมนู/);
assert.match(biz, /bestsellers/);
assert.match(biz, /แบบ fix/);

const sell = read("src/components/PosSellView.tsx");
assert.match(sell, /sortCategoriesByRank|menuArrangeMode/);
assert.match(sell, /subscribePosMenuRank/);

const sales = read("src/lib/pos-sales.ts");
assert.match(sales, /recordBestsellerSaleLines/);

const localR = read("src/lib/pos-local-receipts.ts");
assert.match(localR, /reverseBestsellerSaleLines/);

const sync = read("src/lib/pos-sync.ts");
assert.match(sync, /reverseBestsellerSaleLines/);

const preload = read("src/lib/pos-menu-preload.ts");
assert.match(preload, /arrangeCategoriesForMode|bestsellers/);

const nposSell = read("functions/npos-sell.js");
assert.match(nposSell, /menuArrangeMode/);
assert.match(nposSell, /loadOrRefreshRank|pos-menu-rank/);

const index = read("functions/index.js");
assert.match(index, /posRecomputeMenuRank|posMenuRankDaily/);

const rules = read("firestore.rules");
assert.match(rules, /posMenuRank/);

assert.ok(
  existsSync(
    join(root, "npos-telltea/app/src/main/java/app/telltea/npos/sell/BestsellerPrefs.java"),
  ),
);
const saleSync = read("npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java");
assert.match(saleSync, /BestsellerPrefs/);

const menuModels = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/sell/MenuModels.java",
);
assert.match(menuModels, /menuArrangeMode|isBestsellers/);

const sellAct = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(sellAct, /isBestsellers/);

console.log("OK test-npos-bestseller-rank");
