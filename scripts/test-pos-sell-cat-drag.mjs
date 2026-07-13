import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const drag = readFileSync(join(root, "src/lib/pos-drag-reorder.ts"), "utf8");
assert.match(drag, /applyActiveIdsOrder/);
assert.match(drag, /reorderById/);

const bar = readFileSync(join(root, "src/components/PosSellCategoryBar.tsx"), "utf8");
assert.match(bar, /กดค้างแล้วลากจัดลำดับ/);
assert.match(bar, /beginDrag/);
assert.match(bar, /data-pos-cat-id/);
assert.match(bar, /HOLD_MS/);

const sell = readFileSync(join(root, "src/components/PosSellView.tsx"), "utf8");
assert.match(sell, /PosSellCategoryBar/);
assert.match(sell, /commitCategoryReorder/);
assert.match(sell, /publishLocalMenuOrder/);
assert.match(sell, /reorderMenuCategories/);
assert.match(sell, /กดค้างหมวด = ลากเรียง/);

const css = readFileSync(join(root, "src/app/globals.css"), "utf8");
assert.match(css, /\.pos-sell-cat\.is-dragging/);
assert.match(css, /\.pos-sell-cats\.is-reordering/);

const version = readFileSync(join(root, "src/lib/pos-version.ts"), "utf8");
assert.match(version, /POS_BUILD = 45/);

// applyActiveIdsOrder mirror
function applyActiveIdsOrder(all, orderedActiveIds) {
  const activeSet = new Set(orderedActiveIds);
  const byId = new Map(all.map((row) => [row.id, row]));
  const queue = orderedActiveIds.filter((id) => byId.has(id));
  const sorted = [...all].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  const sequenced = [];
  for (const row of sorted) {
    if (activeSet.has(row.id)) {
      const nextId = queue.shift();
      if (nextId) sequenced.push(byId.get(nextId));
    } else {
      sequenced.push(row);
    }
  }
  return sequenced.map((row, i) => ({ ...row, sortOrder: (i + 1) * 1000 }));
}

const all = [
  { id: "a", sortOrder: 1000, name: "A" },
  { id: "x", sortOrder: 2000, name: "X" },
  { id: "b", sortOrder: 3000, name: "B" },
  { id: "c", sortOrder: 4000, name: "C" },
];
const next = applyActiveIdsOrder(all, ["c", "a", "b"]);
assert.deepEqual(
  next.map((r) => r.id),
  ["c", "x", "a", "b"],
);
assert.equal(next[0].sortOrder, 1000);
assert.equal(next[3].sortOrder, 4000);

console.log("OK pos-sell-cat-drag");
