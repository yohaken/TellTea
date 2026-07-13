/**
 * ตรวจเมนูบน Firestore หลัง seed (ต้องมี FIREBASE_SERVICE_ACCOUNT)
 * Run: FIREBASE_SERVICE_ACCOUNT='...' npm run verify:pos-menu-catalog
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { flattenCatalog } from "./data/pos-menu-catalog.mjs";

const PROJECT = process.env.FIREBASE_PROJECT_ID || "mypeer-501909";

function getAdminDb() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_KEY;
  if (!raw?.trim().startsWith("{")) throw new Error("ต้องมี FIREBASE_SERVICE_ACCOUNT");
  if (!getApps().length) {
    initializeApp({ credential: cert(JSON.parse(raw)), projectId: PROJECT });
  }
  return getFirestore();
}

const expected = flattenCatalog();
const db = getAdminDb();

const [cats, items, groups] = await Promise.all([
  db.collection("menuCategories").get(),
  db.collection("menuItems").get(),
  db.collection("menuOptionGroups").get(),
]);

const issues = [];

if (cats.size < expected.categories.length) {
  issues.push(`หมวดใน DB ${cats.size} < คาด ${expected.categories.length}`);
}
if (items.size < expected.items.length) {
  issues.push(`เมนูใน DB ${items.size} < คาด ${expected.items.length}`);
}
if (groups.size < Object.keys(expected.optionGroups).length) {
  issues.push(`กลุ่มใน DB ${groups.size} < คาด ${Object.keys(expected.optionGroups).length}`);
}

const noodle = items.docs.find((d) => d.data().name === "บะหมี่ เกี๊ยวต้มยำ");
if (!noodle) {
  issues.push('ไม่พบเมนู "บะหมี่ เกี๊ยวต้มยำ"');
} else {
  const data = noodle.data();
  if (data.price !== 119) issues.push(`บะหมี่ราคาผิด: ${data.price}`);
  if (!Array.isArray(data.optionGroupIds) || data.optionGroupIds.length < 2) {
    issues.push("บะหมี่ยังไม่ผูกกลุ่มตัวเลือกครบ");
  }
}

const topping = groups.docs.find((d) => d.data().name === "ท็อปปิ้ง");
if (!topping) {
  issues.push('ไม่พบกลุ่ม "ท็อปปิ้ง"');
} else if ((topping.data().options || []).length < 13) {
  issues.push(`ท็อปปิ้งมีแค่ ${(topping.data().options || []).length} ตัวเลือก`);
}

if (issues.length) {
  console.error("FAIL verify:");
  issues.forEach((x) => console.error(" -", x));
  process.exit(1);
}

console.log("OK verify-pos-menu-catalog");
console.log(`  DB: หมวด ${cats.size} · เมนู ${items.size} · กลุ่ม ${groups.size}`);
