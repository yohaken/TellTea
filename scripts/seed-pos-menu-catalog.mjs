/**
 * นำเข้าเมนู POS จาก scripts/data/pos-menu-catalog.mjs
 *
 *   node scripts/seed-pos-menu-catalog.mjs --dry-run
 *   FIREBASE_SERVICE_ACCOUNT='...' node scripts/seed-pos-menu-catalog.mjs --apply
 *   FIREBASE_SERVICE_ACCOUNT='...' node scripts/seed-pos-menu-catalog.mjs --apply --replace
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { flattenCatalog, CATALOG_META } from "./data/pos-menu-catalog.mjs";

const PROJECT = process.env.FIREBASE_PROJECT_ID || "mypeer-501909";
const APPLY = process.argv.includes("--apply");
const REPLACE = process.argv.includes("--replace");
const DRY = process.argv.includes("--dry-run") || !APPLY;

function loadCredentials() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_KEY;
  if (raw?.trim().startsWith("{")) return JSON.parse(raw);
  return undefined;
}

function getAdminDb() {
  if (!getApps().length) {
    const credentials = loadCredentials();
    if (!credentials) throw new Error("ต้องมี FIREBASE_SERVICE_ACCOUNT สำหรับ --apply");
    initializeApp({ credential: cert(credentials), projectId: PROJECT });
  }
  return getFirestore();
}

function newChoiceId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function buildGroupDoc(key, def, sortOrder, now) {
  const options = def.options.map((o, i) => {
    const row = {
      id: newChoiceId(key),
      name: o.name,
      priceDelta: o.priceDelta,
      sortOrder: (i + 1) * 100,
      active: true,
    };
    if (typeof o.priceDeltaMax === "number") row.priceDeltaMax = o.priceDeltaMax;
    return row;
  });
  const doc = {
    name: def.name,
    required: def.required === true,
    selectionType: def.selectionType,
    options,
    sortOrder,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  if (def.selectionType === "multi") {
    doc.minSelect = 0;
    doc.maxSelect = options.length;
  }
  return doc;
}

async function clearCollection(db, name) {
  const snap = await db.collection(name).get();
  if (snap.empty) return 0;
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  return snap.size;
}

async function main() {
  const { categories, items, optionGroups } = flattenCatalog();
  const groupKeys = Object.keys(optionGroups);

  console.log("=== POS menu catalog import ===");
  console.log("meta:", CATALOG_META.source);
  console.log(`หมวด ${categories.length} · เมนู ${items.length} · กลุ่มตัวเลือก ${groupKeys.length}`);
  console.log(`mode: ${DRY ? "dry-run" : REPLACE ? "apply+replace" : "apply"}`);

  const issues = [];
  for (const item of items) {
    for (const gk of item.optionGroupKeys) {
      if (!optionGroups[gk]) issues.push(`เมนู "${item.name}" อ้างกลุ่มไม่มี: ${gk}`);
    }
  }
  if (issues.length) {
    console.error("ปัญหาความสัมพันธ์:");
    issues.forEach((x) => console.error(" -", x));
    process.exit(1);
  }

  const drinksWithTopping = items.filter((i) => i.optionGroupKeys.includes("topping")).length;
  const noodle = items.find((i) => i.name.includes("บะหมี่"));
  console.log(`เครื่องดื่มผูกท็อปปิ้ง: ${drinksWithTopping} รายการ`);
  console.log(`เมนูอาหารตัวอย่าง: ${noodle?.name} → กลุ่ม [${noodle?.optionGroupKeys.join(", ")}]`);

  if (DRY) {
    console.log("\nOK dry-run — ใช้ --apply เพื่อเขียน Firestore");
    return;
  }

  const db = getAdminDb();
  const now = Date.now();

  if (REPLACE) {
    for (const col of ["menuItems", "menuCategories", "menuOptionGroups"]) {
      const n = await clearCollection(db, col);
      console.log(`ลบ ${col}: ${n} docs`);
    }
  }

  const groupIdByKey = {};
  let gOrder = 0;
  for (const key of groupKeys) {
    gOrder += 1;
    const ref = await db.collection("menuOptionGroups").add(
      buildGroupDoc(key, optionGroups[key], gOrder * 1000, now),
    );
    groupIdByKey[key] = ref.id;
  }
  console.log(`สร้างกลุ่มตัวเลือก: ${groupKeys.length}`);

  const catIdByKey = {};
  for (const cat of categories) {
    const ref = await db.collection("menuCategories").add({
      name: cat.name,
      sortOrder: cat.sortOrder,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    catIdByKey[cat.key] = ref.id;
  }
  console.log(`สร้างหมวด: ${categories.length}`);

  let batch = db.batch();
  let ops = 0;
  for (const item of items) {
    const optionGroupIds = item.optionGroupKeys
      .map((k) => groupIdByKey[k])
      .filter(Boolean);
    const ref = db.collection("menuItems").doc();
    batch.set(ref, {
      categoryId: catIdByKey[item.categoryKey],
      name: item.name,
      price: item.price,
      sortOrder: item.sortOrder,
      active: true,
      visibleOnPos: true,
      recommended: item.recommended === true,
      description: item.description || null,
      optionGroupIds: optionGroupIds.length ? optionGroupIds : null,
      createdAt: now,
      updatedAt: now,
    });
    ops += 1;
    if (ops >= 400) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops) await batch.commit();
  console.log(`สร้างเมนู: ${items.length}`);

  console.log("\nOK seed-pos-menu-catalog applied");
}

main().catch((err) => {
  console.error("FAIL:", err.message);
  process.exit(1);
});
