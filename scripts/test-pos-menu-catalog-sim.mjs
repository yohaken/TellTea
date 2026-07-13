/**
 * จำลองการใช้งานเมนู Wongnai CSV — ตรวจความสัมพันธ์ + cart logic
 */
import assert from "node:assert/strict";
import { flattenCatalog, OPTION_GROUPS } from "./data/pos-menu-catalog.mjs";

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

const { categories, items, optionGroups } = flattenCatalog();
const groupKeys = Object.keys(optionGroups);

assert.ok(categories.length >= 21, `หมวดอย่างน้อย 21 (ได้ ${categories.length})`);
assert.ok(items.length >= 170, `เมนูอย่างน้อย 170 (ได้ ${items.length})`);
assert.ok(groupKeys.length >= 20, `กลุ่มอย่างน้อย 20 (ได้ ${groupKeys.length})`);

const milo = items.find((i) => i.name.includes("ไมโล"));
assert.ok(milo, "มีไมโล (เย็น/ปั่น)");
assert.ok(milo.optionGroupKeys.length >= 3, "ไมโลผูกประเภท+ความหวาน+ท็อปปิ้ง");

const ice = items.find((i) => i.name.includes("ไอศกรีมซอฟต์เสิร์ฟ") && i.name.includes("เล็ก"));
assert.ok(ice, "มีไอศกรีมซอฟต์เสิร์ฟ (เล็ก)");
assert.ok(
  ice.optionGroupKeys.some((k) => optionGroups[k]?.name.includes("รสชาติ")),
  "ไอศครีมผูกรสชาติ",
);

const topping = Object.values(optionGroups).find(
  (g) => g.name === "ท้อปปิ้ง" || g.name === "ท็อปปิ้ง",
);
assert.ok(topping, "มีกลุ่มท็อปปิ้ง");
assert.ok(topping.options.length >= 10);

// จำลอง: ชาไทย + ความหวาน
const sweetGroup = Object.entries(optionGroups).find(([, g]) => g.name === "ความหวาน");
assert.ok(sweetGroup);
const sweetKey = sweetGroup[0];
const wingGroup = {
  id: sweetKey,
  name: OPTION_GROUPS[sweetKey].name,
  required: true,
  selectionType: "single",
  options: OPTION_GROUPS[sweetKey].options.map((o, i) => ({
    id: `s${i}`,
    name: o.name,
    priceDelta: o.priceDelta,
    active: true,
  })),
};
assert.equal(validateSelections([wingGroup], { [sweetKey]: ["s0"] }), null);
assert.match(validateSelections([wingGroup], {}), /เลือก/);

const tea = items.find((i) => i.name.startsWith("ชาไทย"));
assert.ok(tea);
const teaPrice = computeUnitPrice(tea.price, [{ choices: [{ priceDelta: 5 }] }]);
assert.ok(teaPrice >= tea.price);

console.log("OK pos-menu-catalog-sim");
console.log(`  หมวด ${categories.length} · เมนู ${items.length} · กลุ่ม ${groupKeys.length}`);
console.log(`  ไมโล กลุ่ม ${milo.optionGroupKeys.length} · ชาไทย ฿${tea.price}`);
