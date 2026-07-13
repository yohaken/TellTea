/**
 * ตรวจเมนูบน Firestore หลัง seed
 */
import { getSeedDb } from "./lib/pos-firebase-seed.mjs";
import { collection, getDocs } from "firebase/firestore";
import { flattenCatalog } from "./data/pos-menu-catalog.mjs";

const expected = flattenCatalog();
const db = await getSeedDb();

const [cats, items, groups] = await Promise.all([
  getDocs(collection(db, "menuCategories")),
  getDocs(collection(db, "menuItems")),
  getDocs(collection(db, "menuOptionGroups")),
]);

const issues = [];

if (cats.size < expected.categories.length) {
  issues.push(`หมวดใน DB ${cats.size} < คาด ${expected.categories.length}`);
}
if (items.size < expected.items.length) {
  issues.push(`เมนูใน DB ${items.size} < คาด ${expected.items.length}`);
}
if (groups.size < Object.keys(expected.optionGroups).length) {
  issues.push(
    `กลุ่มใน DB ${groups.size} < คาด ${Object.keys(expected.optionGroups).length}`,
  );
}

const milo = items.docs.find((d) => d.data().name?.includes("ไมโล"));
if (!milo) {
  issues.push('ไม่พบเมนู "ไมโล"');
} else if (!Array.isArray(milo.data().optionGroupIds) || milo.data().optionGroupIds.length < 2) {
  issues.push("ไมโลยังไม่ผูกกลุ่มตัวเลือกครบ");
}

const sweet = groups.docs.find((d) => d.data().name === "ความหวาน");
if (!sweet) issues.push('ไม่พบกลุ่ม "ความหวาน"');
else if ((sweet.data().options || []).length < 5) {
  issues.push(`ความหวานมีแค่ ${(sweet.data().options || []).length} ตัวเลือก`);
}

const ice = items.docs.find(
  (d) => d.data().name?.includes("ไอศกรีมซอฟต์เสิร์ฟ") && d.data().name?.includes("เล็ก"),
);
if (!ice) {
  issues.push("ไม่พบไอศกรีมซอฟต์เสิร์ฟ (เล็ก)");
} else if (!Array.isArray(ice.data().optionGroupIds) || !ice.data().optionGroupIds.length) {
  issues.push("ไอศครีมยังไม่ผูกรสชาติ");
}

if (issues.length) {
  console.error("FAIL verify:");
  issues.forEach((x) => console.error(" -", x));
  process.exit(1);
}

console.log("OK verify-pos-menu-catalog");
console.log(`  DB: หมวด ${cats.size} · เมนู ${items.size} · กลุ่ม ${groups.size}`);

process.exit(0);
