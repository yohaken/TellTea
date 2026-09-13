#!/usr/bin/env node
/**
 * เมนูในหมวด «ทัอปปิ้ง» คือท็อปปิ้งเอง — ห้ามผูกกลุ่มตัวเลือก
 * ล้าง optionGroupIds หลังร้าน + bump menuVersion
 *
 *   node scripts/pos-clear-topping-item-options.mjs --dry-run
 *   node scripts/pos-clear-topping-item-options.mjs --apply
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collection, doc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { getSeedDb } from "./lib/pos-firebase-seed.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const LOG = join(__dir, "data/menu-price-baseline/pos-clear-topping-item-options-log.json");

const apply = process.argv.includes("--apply");
const dryRun = !apply || process.argv.includes("--dry-run");

function isToppingCat(name) {
  return /ท็?อ?ปปิ้ง|ท้อปปิ้ง|ทัอปปิ้ง|topping/i.test(String(name || ""));
}

async function bumpMenuVersion(db) {
  await setDoc(doc(db, "meta", "pos"), { menuVersion: Date.now() }, { merge: true });
}

async function main() {
  const db = await getSeedDb();
  const [itemsSnap, catsSnap, groupsSnap] = await Promise.all([
    getDocs(collection(db, "menuItems")),
    getDocs(collection(db, "menuCategories")),
    getDocs(collection(db, "menuOptionGroups")),
  ]);
  const cats = new Map(catsSnap.docs.map((d) => [d.id, d.data()?.name || ""]));
  const groups = new Map(
    groupsSnap.docs.map((d) => [d.id, String(d.data()?.name || "")]),
  );

  const rows = [];
  for (const d of itemsSnap.docs) {
    const data = d.data() || {};
    if (data.active === false) continue;
    const cat = cats.get(data.categoryId) || "";
    if (!isToppingCat(cat)) continue;
    const ids = Array.isArray(data.optionGroupIds) ? data.optionGroupIds : [];
    if (!ids.length) continue;
    rows.push({
      id: d.id,
      name: data.name || "",
      category: cat,
      from: ids.map((id) => groups.get(id) || id),
      fromIds: ids,
    });
  }

  console.log(
    JSON.stringify(
      { dryRun, clearCount: rows.length, rows: rows.map((r) => ({ name: r.name, from: r.from })) },
      null,
      2,
    ),
  );

  if (dryRun) {
    writeFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), dryRun: true, rows }, null, 2) + "\n");
    return;
  }

  for (const r of rows) {
    await updateDoc(doc(db, "menuItems", r.id), {
      optionGroupIds: [],
      updatedAt: Date.now(),
    });
    console.log(`  cleared ${r.name}`);
  }
  await bumpMenuVersion(db);
  writeFileSync(
    LOG,
    JSON.stringify({ at: new Date().toISOString(), dryRun: false, cleared: rows.length, rows }, null, 2) + "\n",
  );
  console.log(`OK cleared ${rows.length} topping items · menuVersion bumped`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
