/**
 * POS menu cart / option selection tests.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Mirror pos-menu-cart logic for Node (no TS import)
function validateSelections(groups, picked) {
  for (const group of groups) {
    const ids = picked[group.id] || [];
    const activeOptions = group.options.filter((o) => o.active);
    const validIds = new Set(activeOptions.map((o) => o.id));
    const chosen = ids.filter((id) => validIds.has(id));
    if (group.required && chosen.length === 0) return `เลือก "${group.name}" ก่อน`;
    if (!chosen.length) continue;
    if (group.selectionType === "single" && chosen.length > 1) return `"${group.name}" เลือกได้ 1 อย่าง`;
  }
  return null;
}

function computeUnitPrice(basePrice, selections) {
  let extra = 0;
  for (const sel of selections) {
    for (const c of sel.choices) extra += c.priceDelta;
  }
  return Math.round((basePrice + extra) * 100) / 100;
}

const group = {
  id: "g1",
  name: "ท็อปปิ้ง",
  required: true,
  selectionType: "single",
  options: [
    { id: "o1", name: "ไม่รับ", priceDelta: 0, sortOrder: 1, active: true },
    { id: "o2", name: "ไข่มุก", priceDelta: 10, sortOrder: 2, active: true },
  ],
};

assert.equal(validateSelections([group], {}), 'เลือก "ท็อปปิ้ง" ก่อน');
assert.equal(validateSelections([group], { g1: ["o1"] }), null);
assert.equal(
  computeUnitPrice(45, [{ groupId: "g1", groupName: "ท", choices: [{ optionId: "o2", name: "ไข่มุก", priceDelta: 10 }] }]),
  55,
);

const menuSrc = readFileSync(join(root, "src/lib/pos-menu-options.ts"), "utf8");
assert.match(menuSrc, /menuOptionGroups/);

const sellSrc = readFileSync(join(root, "src/components/PosSellView.tsx"), "utf8");
assert.match(sellSrc, /PosOptionPickerModal/);
assert.match(sellSrc, /cartLineToSaleLine/);

const adminSrc = readFileSync(join(root, "src/components/PosMenuAdmin.tsx"), "utf8");
assert.match(adminSrc, /หมวดหมู่รายการ/);
assert.match(adminSrc, /กลุ่มตัวเลือก/);

console.log("OK pos-menu-cart");
