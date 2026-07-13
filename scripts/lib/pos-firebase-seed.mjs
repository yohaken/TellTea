/**
 * Firebase client for Node seed scripts (anonymous POS auth).
 */
import { initializeApp, getApps } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  collection,
  getDocs,
  deleteDoc,
  addDoc,
  writeBatch,
  doc,
} from "firebase/firestore";

const PROJECT = process.env.FIREBASE_PROJECT_ID || "mypeer-501909";
const API_KEY =
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyD_b7TASutFOmoUKskH6yLjmxJzVpTUIn4";

function firebaseConfig() {
  return {
    apiKey: API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || `${PROJECT}.firebaseapp.com`,
    projectId: PROJECT,
    storageBucket:
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || `${PROJECT}.appspot.com`,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "",
  };
}

let db;

export async function getSeedDb() {
  if (db) return db;
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig(), "pos-seed");
  const auth = getAuth(app);
  await signInAnonymously(auth);
  try {
    db = initializeFirestore(app, { localCache: memoryLocalCache() });
  } catch {
    db = getFirestore(app);
  }
  return db;
}

export async function clearCollection(dbRef, name) {
  const snap = await getDocs(collection(dbRef, name));
  if (snap.empty) return 0;
  let batch = writeBatch(dbRef);
  let ops = 0;
  let deleted = 0;
  for (const d of snap.docs) {
    batch.delete(d.ref);
    ops += 1;
    deleted += 1;
    if (ops >= 400) {
      await batch.commit();
      batch = writeBatch(dbRef);
      ops = 0;
    }
  }
  if (ops) await batch.commit();
  return deleted;
}

function newChoiceId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function buildGroupDoc(key, def, sortOrder, now) {
  const options = def.options.map((o, i) => ({
    id: newChoiceId(key),
    name: o.name,
    priceDelta: o.priceDelta,
    ...(typeof o.priceDeltaMax === "number" ? { priceDeltaMax: o.priceDeltaMax } : {}),
    sortOrder: (i + 1) * 100,
    active: true,
  }));
  const docData = {
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
    docData.minSelect = def.minSelect ?? (def.required ? 1 : 0);
    docData.maxSelect = def.maxSelect ?? options.length;
  }
  return docData;
}

export async function seedCatalogToFirestore(catalog, { replace = false } = {}) {
  const dbRef = await getSeedDb();
  const now = Date.now();
  const { categories, items, optionGroups } = catalog;
  const groupKeys = Object.keys(optionGroups);

  if (replace) {
    for (const col of ["menuItems", "menuCategories", "menuOptionGroups"]) {
      const n = await clearCollection(dbRef, col);
      console.log(`ลบ ${col}: ${n} docs`);
    }
  }

  const groupIdByKey = {};
  let gOrder = 0;
  for (const key of groupKeys) {
    gOrder += 1;
    const ref = await addDoc(
      collection(dbRef, "menuOptionGroups"),
      buildGroupDoc(key, optionGroups[key], gOrder * 1000, now),
    );
    groupIdByKey[key] = ref.id;
  }
  console.log(`สร้างกลุ่มตัวเลือก: ${groupKeys.length}`);

  const catIdByKey = {};
  for (const cat of categories) {
    const ref = await addDoc(collection(dbRef, "menuCategories"), {
      name: cat.name,
      sortOrder: cat.sortOrder,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    catIdByKey[cat.key] = ref.id;
  }
  console.log(`สร้างหมวด: ${categories.length}`);

  let batch = writeBatch(dbRef);
  let ops = 0;
  for (const item of items) {
    const optionGroupIds = (item.optionGroupKeys || [])
      .map((k) => groupIdByKey[k])
      .filter(Boolean);
    const ref = doc(collection(dbRef, "menuItems"));
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
      batch = writeBatch(dbRef);
      ops = 0;
    }
  }
  if (ops) await batch.commit();
  console.log(`สร้างเมนู: ${items.length}`);

  return { groupIdByKey, catIdByKey };
}
