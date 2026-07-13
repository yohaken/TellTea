/**
 * นำเข้าเมนู POS จาก Wongnai CSV export
 *
 *   npm run seed:pos-menu-catalog -- --dry-run
 *   npm run seed:pos-menu-catalog -- --apply
 *   npm run seed:pos-menu-catalog -- --apply --replace
 *
 * ใช้ anonymous POS auth (ไม่ต้องมี service account) หรือ firebase-admin ถ้ามี FIREBASE_SERVICE_ACCOUNT
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { flattenCatalog, CATALOG_META } from "./data/pos-menu-catalog.mjs";
import { seedCatalogToFirestore, buildGroupDoc } from "./lib/pos-firebase-seed.mjs";

const PROJECT = process.env.FIREBASE_PROJECT_ID || "mypeer-501909";
const APPLY = process.argv.includes("--apply");
const REPLACE = process.argv.includes("--replace");
const DRY = process.argv.includes("--dry-run") || !APPLY;
const USE_ADMIN = process.argv.includes("--admin") || Boolean(process.env.FIREBASE_SERVICE_ACCOUNT);

function loadCredentials() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_KEY;
  if (raw?.trim().startsWith("{")) return JSON.parse(raw);
  return undefined;
}

function getAdminDb() {
  if (!getApps().length) {
    const credentials = loadCredentials();
    if (!credentials) throw new Error("ต้องมี FIREBASE_SERVICE_ACCOUNT สำหรับ --admin");
    initializeApp({ credential: cert(credentials), projectId: PROJECT });
  }
  return getFirestore();
}

async function clearCollectionAdmin(db, name) {
  const snap = await db.collection(name).get();
  if (snap.empty) return 0;
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  return snap.size;
}

async function seedWithAdmin(catalog, replace) {
  const db = getAdminDb();
  const now = Date.now();
  const { categories, items, optionGroups } = catalog;
  const groupKeys = Object.keys(optionGroups);

  if (replace) {
    for (const col of ["menuItems", "menuCategories", "menuOptionGroups"]) {
      const n = await clearCollectionAdmin(db, col);
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
    const optionGroupIds = (item.optionGroupKeys || [])
      .map((k) => groupIdByKey[k])
      .filter(Boolean);
    const ref = db.collection("menuItems").doc();
    batch.set(ref, {
      categoryId: catIdByKey[item.categoryKey],
      name: item.name,
      ...(item.nameEn ? { nameEn: item.nameEn } : {}),
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
}

async function main() {
  const catalog = flattenCatalog();
  const { categories, items, optionGroups } = catalog;
  const groupKeys = Object.keys(optionGroups);

  console.log("=== POS menu catalog import (Wongnai CSV) ===");
  console.log("meta:", CATALOG_META.source);
  console.log(`หมวด ${categories.length} · เมนู ${items.length} · กลุ่มตัวเลือก ${groupKeys.length}`);
  console.log(`mode: ${DRY ? "dry-run" : REPLACE ? "apply+replace" : "apply"}`);

  const issues = [];
  for (const item of items) {
    for (const gk of item.optionGroupKeys || []) {
      if (!optionGroups[gk]) issues.push(`เมนู "${item.name}" อ้างกลุ่มไม่มี: ${gk}`);
    }
  }
  if (issues.length) {
    console.error("ปัญหาความสัมพันธ์:");
    issues.forEach((x) => console.error(" -", x));
    process.exit(1);
  }

  const withGroups = items.filter((i) => (i.optionGroupKeys || []).length > 0).length;
  const ice = items.filter((i) => i.categoryName?.includes("ไอศครีม"));
  console.log(`เมนูผูกตัวเลือก: ${withGroups}/${items.length}`);
  console.log(`ไอศครีม (หมวด): ${ice.length} รายการ`);

  if (DRY) {
    console.log("\nOK dry-run — ใช้ --apply เพื่อเขียน Firestore");
    return;
  }

  if (USE_ADMIN && loadCredentials()) {
    console.log("auth: firebase-admin");
    await seedWithAdmin(catalog, REPLACE);
  } else {
    console.log("auth: anonymous POS client");
    await seedCatalogToFirestore(catalog, { replace: REPLACE });
  }

  console.log("\nOK seed-pos-menu-catalog applied");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("FAIL:", err.message);
    process.exit(1);
  });
