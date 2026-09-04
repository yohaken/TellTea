#!/usr/bin/env node
/**
 * Restore store prices (menu + options) from Wongnai export baseline.
 * Does NOT touch deliveryPrice / deliveryPriceDelta.
 *
 *   node scripts/restore-menu-store-prices-wongnai.mjs           # apply
 *   node scripts/restore-menu-store-prices-wongnai.mjs --dry-run
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { getSeedDb } from "./lib/pos-firebase-seed.mjs";
import { buildCatalogFromWongnaiExport, DEFAULT_EXPORT_DIR } from "./lib/wongnai-csv.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const DRY = process.argv.includes("--dry-run");
const STAMP = new Date().toISOString().slice(0, 10);

function norm(s) {
  return String(s || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function keyName(s) {
  return norm(s).replace(/\s/g, "").toLowerCase();
}

function optKey(group, option) {
  return `${keyName(group)}::${keyName(option)}`;
}

async function bumpMenuVersion(db) {
  await setDoc(doc(db, "meta", "pos"), { menuVersion: Date.now() }, { merge: true });
}

function isTestItem(name) {
  const n = norm(name);
  return /\[QA-TEST\]/i.test(n) || /^เทส(\s*2)?$/i.test(n);
}

async function main() {
  const db = await getSeedDb();
  const wongnai = buildCatalogFromWongnaiExport(DEFAULT_EXPORT_DIR);

  const wMenu = new Map(wongnai.items.map((i) => [keyName(i.name), i]));
  const wOpt = new Map();
  for (const g of Object.values(wongnai.optionGroups)) {
    for (const o of g.options) {
      wOpt.set(optKey(g.name, o.name), { group: g.name, option: o.name, priceDelta: o.priceDelta });
    }
  }

  const [itemSnap, groupSnap] = await Promise.all([
    getDocs(query(collection(db, "menuItems"), orderBy("sortOrder", "asc"))),
    getDocs(query(collection(db, "menuOptionGroups"), orderBy("sortOrder", "asc"))),
  ]);

  const backup = { at: new Date().toISOString(), menuItems: [], optionGroups: [] };
  const menuChanges = [];
  const optChanges = [];
  const now = Date.now();

  for (const d of itemSnap.docs) {
    const x = d.data();
    backup.menuItems.push({ id: d.id, name: x.name, price: x.price, deliveryPrice: x.deliveryPrice ?? null });
    const w = wMenu.get(keyName(x.name));
    if (!w) continue;
    const cur = typeof x.price === "number" ? x.price : 0;
    if (cur === w.price) continue;
    if (isTestItem(x.name)) continue;
    menuChanges.push({
      id: d.id,
      name: norm(x.name),
      from: cur,
      to: w.price,
    });
  }

  const groupUpdates = [];
  for (const d of groupSnap.docs) {
    const g = d.data();
    const options = Array.isArray(g.options) ? g.options : [];
    backup.optionGroups.push({ id: d.id, name: g.name, options: options.map((o) => ({ id: o.id, name: o.name, priceDelta: o.priceDelta, deliveryPriceDelta: o.deliveryPriceDelta ?? null })) });

    let changed = false;
    const nextOptions = options.map((o) => {
      const w = wOpt.get(optKey(g.name, o.name));
      if (!w) return o;
      const cur = typeof o.priceDelta === "number" ? o.priceDelta : 0;
      if (cur === w.priceDelta) return o;
      changed = true;
      optChanges.push({
        group: norm(g.name),
        option: norm(o.name),
        from: cur,
        to: w.priceDelta,
      });
      return { ...o, priceDelta: w.priceDelta };
    });

    if (changed) {
      groupUpdates.push({ id: d.id, name: norm(g.name), options: nextOptions });
    }
  }

  const backupPath = join(__dir, `data/menu-price-baseline/backup-before-restore-${STAMP}.json`);
  writeFileSync(backupPath, JSON.stringify(backup, null, 2));

  console.log(DRY ? "DRY-RUN" : "APPLY", "restore Wongnai store prices");
  console.log("  backup:", backupPath);
  console.log("  menu changes:", menuChanges.length);
  console.log("  option changes:", optChanges.length);

  if (menuChanges.length) {
    console.log("  menu sample:", menuChanges.slice(0, 5).map((c) => `${c.name}: ${c.from}→${c.to}`).join(" | "));
  }
  if (optChanges.length) {
    console.log("  opt sample:", optChanges.slice(0, 5).map((c) => `${c.group}/${c.option}: ${c.from}→${c.to}`).join(" | "));
  }

  if (DRY) {
    writeFileSync(
      join(__dir, "data/menu-price-baseline/restore-plan-dry-run.json"),
      JSON.stringify({ menuChanges, optChanges }, null, 2),
    );
    return;
  }

  // menu items — batched
  const BATCH = 400;
  for (let i = 0; i < menuChanges.length; i += BATCH) {
    const batch = writeBatch(db);
    for (const c of menuChanges.slice(i, i + BATCH)) {
      batch.update(doc(db, "menuItems", c.id), { price: c.to, updatedAt: now });
    }
    await batch.commit();
  }

  // option groups — one doc each (embedded options array)
  for (const g of groupUpdates) {
    await updateDoc(doc(db, "menuOptionGroups", g.id), {
      options: g.options,
      updatedAt: now,
    });
  }

  await bumpMenuVersion(db);

  const logPath = join(__dir, `data/menu-price-baseline/restore-log-${STAMP}.json`);
  writeFileSync(logPath, JSON.stringify({ menuChanges, optChanges, backupPath }, null, 2));
  console.log("OK restore complete — menuVersion bumped");
  console.log("  log:", logPath);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
