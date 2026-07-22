/**
 * Apply FoodStory snapshot → Firestore POS menu (Phase 1).
 *
 *   npm run foodstory:menu-apply -- --dry-run
 *   npm run foodstory:menu-apply -- --apply
 *   npm run foodstory:menu-apply -- --apply --keep-orphans
 *
 * Default snapshot: scripts/data/foodstory-snapshots/snapshot-latest.json
 *
 * Rules (locked):
 * - Upsert by externalSource=foodstory + externalId
 * - Overwrite name/price/category/options from snapshot
 * - Delete foodstory-sourced docs missing from snapshot
 * - Never delete/update source=manual
 * - By default also prune orphan docs (no foodstory externalId, not manual)
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collection,
  doc,
  getDocs,
  writeBatch,
  setDoc,
} from "firebase/firestore";
import { getSeedDb } from "./lib/pos-firebase-seed.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SNAPSHOT = join(__dir, "data/foodstory-snapshots/snapshot-latest.json");
const REPORT_DIR = join(__dir, "data/foodstory-snapshots");

const APPLY = process.argv.includes("--apply");
const DRY = process.argv.includes("--dry-run") || !APPLY;
const KEEP_ORPHANS = process.argv.includes("--keep-orphans");
const SNAPSHOT_PATH = resolve(
  argValue("--snapshot") || process.env.FOODSTORY_SNAPSHOT || DEFAULT_SNAPSHOT,
);

const SOURCE = "foodstory";

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i < 0) return null;
  return process.argv[i + 1] || null;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function isManual(data) {
  return data?.source === "manual";
}

function isFoodstory(data) {
  return data?.externalSource === SOURCE || data?.source === SOURCE;
}

function externalIdOf(data) {
  if (!data) return "";
  if (data.externalId != null && String(data.externalId)) return String(data.externalId);
  return "";
}

function choiceIdFor(externalId, existingId) {
  if (existingId) return existingId;
  return `fs_c_${externalId}`;
}

async function loadCollection(db, name) {
  const snap = await getDocs(collection(db, name));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function commitBatches(db, ops) {
  // ops: Array<() => void that receives batch> — simpler: array of {type, ref, data?}
  let batch = writeBatch(db);
  let n = 0;
  let commits = 0;
  for (const op of ops) {
    if (op.type === "set") batch.set(op.ref, op.data, { merge: op.merge === true });
    else if (op.type === "delete") batch.delete(op.ref);
    else if (op.type === "update") batch.update(op.ref, op.data);
    n += 1;
    if (n >= 400) {
      if (!DRY) await batch.commit();
      commits += 1;
      batch = writeBatch(db);
      n = 0;
    }
  }
  if (n && !DRY) {
    await batch.commit();
    commits += 1;
  }
  return commits;
}

function buildChoiceMap(existingGroup) {
  const byExt = new Map();
  const options = Array.isArray(existingGroup?.options) ? existingGroup.options : [];
  for (const o of options) {
    if (o?.externalId != null) byExt.set(String(o.externalId), o);
    else if (typeof o?.id === "string" && o.id.startsWith("fs_c_")) {
      byExt.set(o.id.slice(5), o);
    }
  }
  return byExt;
}

export async function planFoodstoryApply(snapshot, existing) {
  const now = Date.now();
  const plan = {
    categories: { create: [], update: [], delete: [] },
    optionGroups: { create: [], update: [], delete: [] },
    items: { create: [], update: [], delete: [] },
    orphans: { categories: [], optionGroups: [], items: [] },
    preservedManual: { categories: 0, optionGroups: 0, items: 0 },
  };

  const catByExt = new Map();
  const groupByExt = new Map();
  const itemByExt = new Map();

  for (const c of existing.categories) {
    if (isManual(c)) {
      plan.preservedManual.categories += 1;
      continue;
    }
    const ext = externalIdOf(c);
    if (isFoodstory(c) && ext) catByExt.set(ext, c);
    else plan.orphans.categories.push(c);
  }
  for (const g of existing.optionGroups) {
    if (isManual(g)) {
      plan.preservedManual.optionGroups += 1;
      continue;
    }
    const ext = externalIdOf(g);
    if (isFoodstory(g) && ext) groupByExt.set(ext, g);
    else plan.orphans.optionGroups.push(g);
  }
  for (const it of existing.items) {
    if (isManual(it)) {
      plan.preservedManual.items += 1;
      continue;
    }
    const ext = externalIdOf(it);
    if (isFoodstory(it) && ext) itemByExt.set(ext, it);
    else plan.orphans.items.push(it);
  }

  /** @type {Map<string, string>} externalId → firestoreId */
  const catIdMap = new Map();
  const groupIdMap = new Map();

  for (const cat of snapshot.categories || []) {
    const ext = String(cat.externalId);
    const prev = catByExt.get(ext);
    const firestoreId = prev?.id || `fs_cat_${ext}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
    catIdMap.set(ext, firestoreId);
    const docData = {
      name: cat.name,
      sortOrder: typeof cat.sortOrder === "number" ? cat.sortOrder : 0,
      active: cat.active !== false,
      externalSource: SOURCE,
      externalId: ext,
      source: SOURCE,
      updatedAt: now,
      ...(prev ? {} : { createdAt: now }),
    };
    if (prev) plan.categories.update.push({ id: firestoreId, ext, before: prev.name, after: cat.name, data: docData });
    else plan.categories.create.push({ id: firestoreId, ext, name: cat.name, data: docData });
    catByExt.delete(ext);
  }
  for (const [ext, prev] of catByExt) {
    plan.categories.delete.push({ id: prev.id, ext, name: prev.name });
  }

  for (const g of snapshot.optionGroups || []) {
    const ext = String(g.externalId);
    const prev = groupByExt.get(ext);
    const firestoreId = prev?.id || `fs_opt_${ext}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
    groupIdMap.set(ext, firestoreId);
    const prevChoices = buildChoiceMap(prev);
    const options = (g.options || []).map((o, i) => {
      const oExt = String(o.externalId);
      const prevO = prevChoices.get(oExt);
      return {
        id: choiceIdFor(oExt, prevO?.id),
        externalId: oExt,
        name: o.name,
        priceDelta: typeof o.priceDelta === "number" ? o.priceDelta : 0,
        sortOrder: typeof o.sortOrder === "number" ? o.sortOrder : (i + 1) * 100,
        active: o.active !== false,
      };
    });
    const docData = {
      name: g.name,
      required: g.required === true,
      selectionType: g.selectionType || "single",
      options,
      sortOrder: typeof g.sortOrder === "number" ? g.sortOrder : 0,
      active: g.active !== false,
      externalSource: SOURCE,
      externalId: ext,
      source: SOURCE,
      updatedAt: now,
      ...(prev ? {} : { createdAt: now }),
    };
    if (g.selectionType === "multi" || g.selectionType === "unlimited") {
      if (typeof g.minSelect === "number") docData.minSelect = g.minSelect;
      if (typeof g.maxSelect === "number") docData.maxSelect = g.maxSelect;
    } else if (g.required) {
      docData.minSelect = 1;
      docData.maxSelect = 1;
    }
    if (prev) plan.optionGroups.update.push({ id: firestoreId, ext, name: g.name, data: docData });
    else plan.optionGroups.create.push({ id: firestoreId, ext, name: g.name, data: docData });
    groupByExt.delete(ext);
  }
  for (const [ext, prev] of groupByExt) {
    plan.optionGroups.delete.push({ id: prev.id, ext, name: prev.name });
  }

  for (const item of snapshot.items || []) {
    const ext = String(item.externalId);
    const prev = itemByExt.get(ext);
    const firestoreId = prev?.id || `fs_item_${ext}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
    const categoryId = catIdMap.get(String(item.categoryExternalId)) || prev?.categoryId || "";
    const optionGroupIds = (item.optionGroupExternalIds || [])
      .map((gid) => groupIdMap.get(String(gid)))
      .filter(Boolean);

    const docData = {
      categoryId,
      name: item.name,
      price: typeof item.price === "number" ? item.price : 0,
      sortOrder: typeof item.sortOrder === "number" ? item.sortOrder : 0,
      active: item.active !== false,
      visibleOnPos: prev?.visibleOnPos !== false,
      recommended: prev?.recommended === true,
      optionGroupIds,
      externalSource: SOURCE,
      externalId: ext,
      source: SOURCE,
      updatedAt: now,
      ...(prev ? {} : { createdAt: now }),
    };
    if (item.nameEn) docData.nameEn = item.nameEn;
    if (item.description) docData.description = item.description;
    if (item.code) docData.code = item.code;
    // Prefer FS image URL; keep existing POS-uploaded data: URL if FS has none
    if (item.imageUrl) docData.imageUrl = item.imageUrl;
    else if (prev?.imageUrl) docData.imageUrl = prev.imageUrl;
    if (item.imageKey) docData.imageKey = item.imageKey;

    if (prev) {
      plan.items.update.push({
        id: firestoreId,
        ext,
        name: item.name,
        data: docData,
        ...(categoryId ? {} : { warn: "missing categoryId" }),
      });
    } else {
      plan.items.create.push({
        id: firestoreId,
        ext,
        name: item.name,
        data: docData,
        ...(categoryId ? {} : { warn: "missing categoryId" }),
      });
    }
    itemByExt.delete(ext);
  }
  for (const [ext, prev] of itemByExt) {
    plan.items.delete.push({ id: prev.id, ext, name: prev.name });
  }

  return { plan, catIdMap, groupIdMap, now };
}

async function main() {
  if (!existsSync(SNAPSHOT_PATH)) {
    console.error("ไม่พบ snapshot:", SNAPSHOT_PATH);
    console.error("รัน foodstory:menu-capture ก่อน หรือส่ง --snapshot path");
    process.exit(2);
  }

  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
  if (!snapshot?.items?.length) {
    console.error("snapshot ไม่มี items");
    process.exit(2);
  }

  console.log("=== FoodStory → POS Web apply (Phase 1) ===");
  console.log("mode:", DRY ? "DRY-RUN" : "APPLY");
  console.log("snapshot:", SNAPSHOT_PATH);
  console.log("counts:", snapshot.meta?.counts || {
    categories: snapshot.categories?.length,
    items: snapshot.items?.length,
    optionGroups: snapshot.optionGroups?.length,
  });
  console.log("prune orphans:", KEEP_ORPHANS ? "no (--keep-orphans)" : "yes");

  const db = await getSeedDb();
  const existing = {
    categories: await loadCollection(db, "menuCategories"),
    items: await loadCollection(db, "menuItems"),
    optionGroups: await loadCollection(db, "menuOptionGroups"),
  };
  console.log("existing Firestore:", {
    categories: existing.categories.length,
    items: existing.items.length,
    optionGroups: existing.optionGroups.length,
  });

  const { plan, now } = await planFoodstoryApply(snapshot, existing);

  const summary = {
    categories: {
      create: plan.categories.create.length,
      update: plan.categories.update.length,
      delete: plan.categories.delete.length,
      orphanDelete: KEEP_ORPHANS ? 0 : plan.orphans.categories.length,
    },
    optionGroups: {
      create: plan.optionGroups.create.length,
      update: plan.optionGroups.update.length,
      delete: plan.optionGroups.delete.length,
      orphanDelete: KEEP_ORPHANS ? 0 : plan.orphans.optionGroups.length,
    },
    items: {
      create: plan.items.create.length,
      update: plan.items.update.length,
      delete: plan.items.delete.length,
      orphanDelete: KEEP_ORPHANS ? 0 : plan.orphans.items.length,
    },
    preservedManual: plan.preservedManual,
  };
  console.log("plan:", JSON.stringify(summary, null, 2));

  mkdirSync(REPORT_DIR, { recursive: true });
  const reportPath = join(REPORT_DIR, `apply-plan-${stamp()}.json`);
  writeFileSync(reportPath, JSON.stringify({ summary, plan, meta: snapshot.meta }, null, 2));
  console.log("plan report:", reportPath);

  if (DRY) {
    console.log("dry-run เท่านั้น — ยังไม่เขียน Firestore (ใส่ --apply เพื่อเขียน)");
    return;
  }

  const ops = [];
  const pushSet = (col, row) => {
    ops.push({ type: "set", ref: doc(db, col, row.id), data: row.data, merge: true });
  };
  const pushDel = (col, row) => {
    ops.push({ type: "delete", ref: doc(db, col, row.id) });
  };

  // Creates/updates first (groups + cats before items)
  for (const row of plan.categories.create) pushSet("menuCategories", row);
  for (const row of plan.categories.update) pushSet("menuCategories", row);
  for (const row of plan.optionGroups.create) pushSet("menuOptionGroups", row);
  for (const row of plan.optionGroups.update) pushSet("menuOptionGroups", row);
  for (const row of plan.items.create) pushSet("menuItems", row);
  for (const row of plan.items.update) pushSet("menuItems", row);

  // Deletes: items → groups → categories (+ orphans)
  for (const row of plan.items.delete) pushDel("menuItems", row);
  for (const row of plan.optionGroups.delete) pushDel("menuOptionGroups", row);
  for (const row of plan.categories.delete) pushDel("menuCategories", row);

  if (!KEEP_ORPHANS) {
    for (const row of plan.orphans.items) pushDel("menuItems", row);
    for (const row of plan.orphans.optionGroups) pushDel("menuOptionGroups", row);
    for (const row of plan.orphans.categories) pushDel("menuCategories", row);
  }

  const commits = await commitBatches(db, ops);
  console.log("batch commits:", commits);

  // sync meta (best-effort; anonymous may lack meta write — menu writes still succeed)
  try {
    await setDoc(
      doc(db, "meta", "foodstoryMenuSync"),
      {
        lastAppliedAt: now,
        snapshotCapturedAt: snapshot.meta?.capturedAt || null,
        branchId: snapshot.meta?.branchId || snapshot.meta?.upstream?.branchId || null,
        counts: snapshot.meta?.counts || summary.items,
        summary,
        source: SOURCE,
      },
      { merge: true },
    );
  } catch (err) {
    console.warn("เขียน meta/foodstoryMenuSync ไม่สำเร็จ (ข้ามได้):", err.message);
  }
  try {
    await setDoc(
      doc(db, "meta", "pos"),
      { menuVersion: now, menuSyncedAt: now, menuSource: SOURCE },
      { merge: true },
    );
  } catch (err) {
    console.warn("เขียน meta/pos ไม่สำเร็จ (ข้ามได้):", err.message);
  }

  console.log("APPLY เสร็จ — ตรวจ /pos/menu/ และให้ nPos รีเฟรชเมนู");
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error("apply ล้มเหลว:", err);
    process.exit(1);
  });
}