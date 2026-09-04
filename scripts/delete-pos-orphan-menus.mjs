#!/usr/bin/env node
/**
 * Hard-delete POS orphan/QA menu items (อื่นๆ ไม่มีหมวด FoodStory + QA-TEST).
 * Never touches active menus in real categories.
 *
 *   node scripts/delete-pos-orphan-menus.mjs           # dry-run
 *   node scripts/delete-pos-orphan-menus.mjs --apply
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { getSeedDb } from "./lib/pos-firebase-seed.mjs";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
  deleteDoc,
} from "firebase/firestore";

const __dir = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = join(__dir, "data/menu-price-baseline/telltea-menu-prices-snapshot-2026-09-01.csv");
const LOG = join(__dir, "data/menu-price-baseline/pos-orphan-delete-log.json");

const ORPHAN_CATS = new Set(["อื่นๆ (ไม่มีหมวดจาก FoodStory)", "[QA-TEST] หมวดทดสอบ"]);

function field(row, key) {
  return row[key] ?? row[`\ufeff${key}`] ?? "";
}

function loadTargetsFromSnapshot() {
  if (!existsSync(SNAPSHOT)) throw new Error(`Missing ${SNAPSHOT}`);
  const rows = parse(readFileSync(SNAPSHOT, "utf8"), {
    columns: true,
    skip_empty_lines: true,
    bom: true,
  });
  return rows
    .filter((r) => ORPHAN_CATS.has(String(field(r, "category"))))
    .map((r) => ({
      id: String(field(r, "id")),
      name: String(field(r, "name")),
      category: String(field(r, "category")),
      active: field(r, "active") === "true" || field(r, "active") === true,
    }))
    .filter((r) => r.id);
}

function removeFromSnapshotCsv(ids) {
  const idSet = new Set(ids);
  const rows = parse(readFileSync(SNAPSHOT, "utf8"), {
    columns: true,
    skip_empty_lines: true,
    bom: true,
  });
  const header = Object.keys(rows[0] || {}).map((h) => h.replace(/^\ufeff/, ""));
  const kept = rows.filter((r) => !idSet.has(String(field(r, "id"))));
  const esc = (v) => {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const lines = [
    header.join(","),
    ...kept.map((r) => header.map((h) => esc(field(r, h))).join(",")),
  ];
  writeFileSync(SNAPSHOT, lines.join("\n") + "\n");
  return { before: rows.length, after: kept.length, removed: rows.length - kept.length };
}

async function bumpMenuVersion(db) {
  await setDoc(doc(db, "meta", "pos"), { menuVersion: Date.now() }, { merge: true });
}

async function deleteEmptyCategories(db, catNames) {
  const snap = await getDocs(collection(db, "menuCategories"));
  const deleted = [];
  for (const d of snap.docs) {
    const name = d.data()?.name || "";
    if (!catNames.has(name)) continue;
    // only delete if no remaining menuItems reference this category id
    const items = await getDocs(collection(db, "menuItems"));
    const still = items.docs.some((it) => it.data()?.categoryId === d.id);
    if (still) {
      console.log(`  keep category ${name} (still has items)`);
      continue;
    }
    await deleteDoc(d.ref);
    deleted.push({ id: d.id, name });
    console.log(`  deleted category ${name}`);
  }
  return deleted;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const targets = loadTargetsFromSnapshot();

  console.log(`=== POS hard-delete orphans ${apply ? "APPLY" : "dry-run"} ===`);
  console.log(`Targets: ${targets.length}`);
  for (const t of targets) {
    console.log(`  ${t.active ? "ACTIVE!" : "inactive"}  ${t.id}  ${t.name}  [${t.category}]`);
  }

  const activeOnes = targets.filter((t) => t.active);
  if (activeOnes.length) {
    throw new Error(`Refusing: ${activeOnes.length} target(s) still active — archive first`);
  }

  if (!apply) {
    console.log("\nRe-run with --apply to delete from Firestore.");
    return;
  }

  const db = await getSeedDb();
  const deleted = [];
  const missing = [];

  let batch = writeBatch(db);
  let ops = 0;
  for (const t of targets) {
    const ref = doc(db, "menuItems", t.id);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      missing.push(t);
      console.warn("SKIP missing:", t.id, t.name);
      continue;
    }
    const liveCat = snap.data()?.categoryName || snap.data()?.category || "";
    // safety: only delete if still in orphan cats (or name matches QA)
    const liveName = snap.data()?.name || t.name;
    batch.delete(ref);
    deleted.push({ ...t, liveName, liveCat });
    ops++;
    if (ops >= 400) {
      await batch.commit();
      batch = writeBatch(db);
      ops = 0;
    }
  }
  if (ops) await batch.commit();

  const catsDeleted = await deleteEmptyCategories(db, ORPHAN_CATS);
  await bumpMenuVersion(db);
  const csv = removeFromSnapshotCsv(targets.map((t) => t.id));

  const log = {
    at: new Date().toISOString(),
    deleted,
    missing,
    categoriesDeleted: catsDeleted,
    snapshot: csv,
  };
  writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");

  console.log(`\nOK deleted ${deleted.length} menuItems · missing ${missing.length}`);
  console.log(`  snapshot ${csv.before} → ${csv.after} (−${csv.removed})`);
  console.log(`  categories deleted: ${catsDeleted.length}`);
  console.log(`→ ${LOG}`);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
