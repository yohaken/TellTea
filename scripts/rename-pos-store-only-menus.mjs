#!/usr/bin/env node
/**
 * Append " (เฉพาะหน้าร้าน)" to POS-only menu names in Firestore.
 * Updates menuItems used by POS counter + จัดการร้าน (/menu · PosMenuAdmin) + nPOS sync.
 *
 *   node scripts/rename-pos-store-only-menus.mjs --dry-run
 *   node scripts/rename-pos-store-only-menus.mjs --apply
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { getSeedDb } from "./lib/pos-firebase-seed.mjs";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch } from "firebase/firestore";

const SUFFIX = " (เฉพาะหน้าร้าน)";
const __dir = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = join(__dir, "data/menu-price-baseline/telltea-menu-prices-snapshot-2026-09-01.csv");

/** id → current name (exact match before rename) */
const RENAMES = [
  { id: "fs_item_35165493", from: "(กลาง) ไอศกรีมซอฟต์เสิร์ฟ" },
  { id: "fs_item_36373237", from: "(เล็ก) ไอศกรีมซอฟต์เสิร์ฟ" },
  { id: "fs_item_35165503", from: "(ใหญ่) ไอศกรีมซอฟต์เสิร์ฟ" },
  { id: "fs_item_49716853", from: "น้ำเปล่า" },
];

function targetName(from) {
  if (from.endsWith(SUFFIX)) return from;
  return from + SUFFIX;
}

async function bumpMenuVersion(db) {
  await setDoc(doc(db, "meta", "pos"), { menuVersion: Date.now() }, { merge: true });
}

function updateSnapshotCsv(changes) {
  const raw = readFileSync(SNAPSHOT, "utf8");
  const rows = parse(raw, { columns: true, skip_empty_lines: true });
  const byId = Object.fromEntries(changes.map((c) => [c.id, c.to]));
  let n = 0;
  for (const r of rows) {
    const id = r.id || r["\ufeffid"];
    if (byId[id]) {
      r.name = byId[id];
      n++;
    }
  }
  const header = Object.keys(rows[0]);
  const lines = [
    header.join(","),
    ...rows.map((r) =>
      header
        .map((h) => {
          const v = String(r[h] ?? "");
          return v.includes(",") || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v;
        })
        .join(","),
    ),
  ];
  writeFileSync(SNAPSHOT, lines.join("\n") + "\n");
  return n;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const db = await getSeedDb();
  const now = Date.now();
  const plan = [];

  for (const row of RENAMES) {
    const ref = doc(db, "menuItems", row.id);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      console.warn("SKIP missing:", row.id, row.from);
      continue;
    }
    const cur = snap.data().name || "";
    const to = targetName(row.from);
    if (cur === to) {
      console.log("OK already:", to);
      continue;
    }
    if (cur !== row.from && !cur.endsWith(SUFFIX)) {
      console.warn("WARN name drift:", row.id, "expected", row.from, "got", cur);
    }
    plan.push({ id: row.id, from: cur, to });
  }

  console.log(`=== POS rename store-only ${apply ? "APPLY" : "dry-run"} ===`);
  plan.forEach((p) => console.log(`  ${p.from} → ${p.to}`));
  if (!plan.length) {
    console.log("Nothing to rename.");
    return;
  }

  if (!apply) {
    console.log("\nRe-run with --apply to update Firestore.");
    return;
  }

  const batch = writeBatch(db);
  for (const p of plan) {
    batch.update(doc(db, "menuItems", p.id), { name: p.to, updatedAt: now });
  }
  await batch.commit();
  await bumpMenuVersion(db);

  const snapRows = updateSnapshotCsv(plan);
  console.log(`\nOK Firestore ${plan.length} items · snapshot ${snapRows} rows · menuVersion bumped`);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
