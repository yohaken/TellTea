/**
 * จำลองการใช้งานเมนู — ตรวจความสัมพันธ์ + cart logic (ไม่ต้อง Firestore)
 * Run: npm run test:pos-menu-catalog-sim
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

assert.equal(categories.length, 18, "หมวด 17+อาหาร = 18");
assert.equal(items.length, 117, "รวมเมนู 117");
assert.equal(groupKeys.length, 14, "กลุ่มตัวเลือก 14");

const noodle = items.find((i) => i.name === "บะหมี่ เกี๊ยวต้มยำ");
assert.ok(noodle, "มีบะหมี่ เกี๊ยวต้มยำ");
assert.equal(noodle.price, 119);
assert.ok(noodle.optionGroupKeys.includes("promo_chicken_wing"));
assert.ok(noodle.optionGroupKeys.includes("sauce_dip"));

const topping = optionGroups.topping;
assert.equal(topping.options.length, 13, "ท็อปปิ้ง 13 ตัวเลือกจากรูป");
assert.equal(topping.options[1].priceDeltaMax, 8);

const drinks = items.filter((i) => i.optionGroupKeys.includes("topping"));
assert.ok(drinks.length >= 80, `เครื่องดื่มส่วนใหญ่มีท็อปปิ้ง (ได้ ${drinks.length})`);

// จำลองขาย: บะหมี่ + ปีกไก่
const wingGroup = {
  id: "promo_chicken_wing",
  name: OPTION_GROUPS.promo_chicken_wing.name,
  required: true,
  selectionType: "single",
  options: OPTION_GROUPS.promo_chicken_wing.options.map((o, i) => ({
    id: `w${i}`,
    name: o.name,
    priceDelta: o.priceDelta,
    active: true,
  })),
};
const picked = { promo_chicken_wing: ["w0"] };
assert.equal(validateSelections([wingGroup], picked), null);
const price = computeUnitPrice(119, [
  { choices: [{ priceDelta: 20 }] },
]);
assert.equal(price, 139);

// จำลอง: ลืมเลือกกลุ่มบังคับ
assert.match(validateSelections([wingGroup], {}), /เลือก/);

// จำลอง: ชา + ท็อปปิ้ง 2 อย่าง
const topGroup = {
  id: "topping",
  name: "ท็อปปิ้ง",
  required: false,
  selectionType: "unlimited",
  options: topping.options.map((o, i) => ({
    id: `t${i}`,
    name: o.name,
    priceDelta: o.priceDelta,
    active: true,
  })),
};
const tea = items.find((i) => i.name === "ชาเขียว");
assert.ok(tea);
const teaPrice = computeUnitPrice(tea.price, [
  { choices: [{ priceDelta: 5 }, { priceDelta: 10 }] },
]);
assert.equal(teaPrice, 60);

console.log("OK pos-menu-catalog-sim");
console.log(`  หมวด ${categories.length} · เมนู ${items.length} · กลุ่ม ${groupKeys.length}`);
console.log(`  บะหมี่+ปีกไก่ = ฿${price}`);
console.log(`  ชาเขียว+ท็อปปิ้ง = ฿${teaPrice}`);
