#!/usr/bin/env node
/**
 * Strip () / （） from POS names (keep inner text) so BOH = channels = exact namesEqual.
 * Skips storeOnly / เฉพาะหน้าร้าน. Blocks colliding targets.
 *
 *   node scripts/pos-strip-parens-rename.mjs --dry-run
 *   node scripts/pos-strip-parens-rename.mjs --dry-run --inventory
 *   node scripts/pos-strip-parens-rename.mjs --apply --menus --limit=5   # pilot
 *   node scripts/pos-strip-parens-rename.mjs --apply --menus --options --categories
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getSeedDb } from "./lib/pos-firebase-seed.mjs";
import {
  collection,
  doc,
  getDocs,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { foldMenuName, normName } from "./lib/grab-csv.mjs";
import { isStoreOnlyName } from "./lib/name-sync-match.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dir, "data/menu-price-baseline");
const PLAN = join(DATA, "pos-strip-parens-plan.json");
const LOG = join(DATA, "pos-strip-parens-log.json");

const HAS_PAREN = /[()（）]/;

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const inventory = args.includes("--inventory");
const allScopes = args.includes("--all");
const anyScope =
  args.includes("--menus") || args.includes("--options") || args.includes("--categories") || allScopes;
/** dry-run เปล่า / --inventory = ทุก scope; --apply ต้องระบุ --all หรือ --menus/--options/--categories */
const doMenus = allScopes || args.includes("--menus") || (!apply && !anyScope) || (inventory && !anyScope);
const doOptions =
  allScopes || args.includes("--options") || (!apply && !anyScope) || (inventory && !anyScope);
const doCategories =
  allScopes || args.includes("--categories") || (!apply && !anyScope) || (inventory && !anyScope);
const limit = Math.max(0, Number((args.find((a) => a.startsWith("--limit=")) || "").slice(8)) || 0);
const idsArg = (args.find((a) => a.startsWith("--ids=")) || "").slice(6);
const onlyIds = new Set(
  idsArg
    ? idsArg
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [],
);

function stripParensName(s) {
  return foldMenuName(s);
}

function needsStrip(s) {
  return HAS_PAREN.test(String(s || ""));
}

async function bumpMenuVersion(db) {
  await setDoc(doc(db, "meta", "pos"), { menuVersion: Date.now() }, { merge: true });
}

function scanChannelFile(path, kind) {
  if (!existsSync(path)) return { kind, missing: true, withParens: [] };
  const j = JSON.parse(readFileSync(path, "utf8"));
  const items = j.items || j.options || [];
  const withParens = [];
  for (const it of items) {
    const name = it.name || "";
    if (!needsStrip(name)) continue;
    withParens.push({
      id: it.id || it.optionId || it.dishId || "",
      group: it.group || it.groupName || it.category || "",
      from: name,
      to: stripParensName(name),
    });
  }
  return {
    kind,
    at: j.scannedAt || j.at || null,
    total: items.length,
    withParens: withParens.length,
    sample: withParens.slice(0, 12),
    rows: withParens,
  };
}

function findCollisions(candidates) {
  /** @type {Map<string, object[]>} */
  const byTo = new Map();
  for (const c of candidates) {
    const k = normName(c.to);
    if (!byTo.has(k)) byTo.set(k, []);
    byTo.get(k).push(c);
  }
  const collisions = [];
  const blockedIds = new Set();
  for (const [to, rows] of byTo) {
    if (rows.length < 2) continue;
    collisions.push({ to, rows: rows.map((r) => ({ id: r.id, from: r.from, scope: r.scope })) });
    for (const r of rows) blockedIds.add(`${r.scope}:${r.id}`);
  }
  return { collisions, blockedIds };
}

async function buildPosPlan(db) {
  const [itemsSnap, catsSnap, groupsSnap] = await Promise.all([
    getDocs(collection(db, "menuItems")),
    getDocs(collection(db, "menuCategories")),
    getDocs(collection(db, "menuOptionGroups")),
  ]);

  /** @type {object[]} */
  const candidates = [];
  /** @type {object[]} */
  const skipped = [];

  if (doMenus) {
    for (const d of itemsSnap.docs) {
      const data = d.data() || {};
      const name = String(data.name || "");
      if (!needsStrip(name)) continue;
      if (onlyIds.size && !onlyIds.has(d.id)) continue;
      if (data.storeOnly === true || isStoreOnlyName(name)) {
        skipped.push({ scope: "menu", id: d.id, from: name, reason: "storeOnly" });
        continue;
      }
      if (data.active === false) {
        skipped.push({ scope: "menu", id: d.id, from: name, reason: "inactive" });
        continue;
      }
      const to = stripParensName(name);
      if (to === normName(name) && to === name) continue;
      if (to === name) continue;
      candidates.push({ scope: "menu", id: d.id, from: name, to });
    }
  }

  if (doCategories) {
    for (const d of catsSnap.docs) {
      const data = d.data() || {};
      const name = String(data.name || "");
      if (!needsStrip(name)) continue;
      if (onlyIds.size && !onlyIds.has(d.id)) continue;
      if (isStoreOnlyName(name)) {
        skipped.push({ scope: "category", id: d.id, from: name, reason: "storeOnly" });
        continue;
      }
      if (data.active === false) {
        skipped.push({ scope: "category", id: d.id, from: name, reason: "inactive" });
        continue;
      }
      const to = stripParensName(name);
      if (to === name) continue;
      candidates.push({ scope: "category", id: d.id, from: name, to });
    }
  }

  if (doOptions) {
    for (const d of groupsSnap.docs) {
      const data = d.data() || {};
      if (data.active === false) continue;
      const gName = String(data.name || "");
      if (needsStrip(gName) && (!onlyIds.size || onlyIds.has(d.id))) {
        const to = stripParensName(gName);
        if (to !== gName) {
          candidates.push({ scope: "optionGroup", id: d.id, from: gName, to });
        }
      }
      const options = Array.isArray(data.options) ? data.options : [];
      let dirty = false;
      const choiceEdits = [];
      for (const c of options) {
        if (!c || c.active === false) continue;
        const n = String(c.name || "");
        if (!needsStrip(n)) continue;
        const key = `${d.id}::${c.id}`;
        if (onlyIds.size && !onlyIds.has(key) && !onlyIds.has(c.id)) continue;
        const to = stripParensName(n);
        if (to === n) continue;
        choiceEdits.push({ choiceId: c.id, from: n, to });
        dirty = true;
      }
      if (dirty) {
        for (const ed of choiceEdits) {
          candidates.push({
            scope: "optionChoice",
            id: `${d.id}::${ed.choiceId}`,
            groupId: d.id,
            choiceId: ed.choiceId,
            from: ed.from,
            to: ed.to,
          });
        }
      }
    }
  }

  // Also block if target equals another existing name that is NOT being renamed away
  const existingMenuNames = new Map();
  for (const d of itemsSnap.docs) {
    const data = d.data() || {};
    if (data.active === false) continue;
    existingMenuNames.set(normName(data.name || ""), d.id);
  }
  const renamingMenus = new Map(
    candidates.filter((c) => c.scope === "menu").map((c) => [c.id, normName(c.to)]),
  );

  const { collisions, blockedIds } = findCollisions(candidates);
  const externalCollisions = [];
  for (const c of candidates) {
    if (c.scope !== "menu") continue;
    const k = normName(c.to);
    const otherId = existingMenuNames.get(k);
    if (otherId && otherId !== c.id && !renamingMenus.has(otherId)) {
      externalCollisions.push({ id: c.id, from: c.from, to: c.to, conflictsWith: otherId });
      blockedIds.add(`menu:${c.id}`);
    }
  }

  const ok = candidates.filter((c) => !blockedIds.has(`${c.scope}:${c.id}`));
  let plan = ok;
  if (limit > 0) plan = plan.slice(0, limit);

  return {
    at: new Date().toISOString(),
    apply: false,
    scopes: {
      menus: doMenus || allScopes,
      options: doOptions || allScopes,
      categories: doCategories || allScopes,
    },
    counts: {
      candidates: candidates.length,
      ok: ok.length,
      plan: plan.length,
      skipped: skipped.length,
      collisions: collisions.length,
      externalCollisions: externalCollisions.length,
    },
    collisions,
    externalCollisions,
    skipped: skipped.slice(0, 50),
    plan,
    blocked: candidates.filter((c) => blockedIds.has(`${c.scope}:${c.id}`)),
  };
}

async function applyPlan(db, planRows) {
  const now = Date.now();
  const menus = planRows.filter((r) => r.scope === "menu");
  const cats = planRows.filter((r) => r.scope === "category");
  const groups = planRows.filter((r) => r.scope === "optionGroup");
  const choices = planRows.filter((r) => r.scope === "optionChoice");

  // menus + categories in batches of 400
  const simple = [...menus, ...cats, ...groups];
  for (let i = 0; i < simple.length; i += 400) {
    const batch = writeBatch(db);
    const chunk = simple.slice(i, i + 400);
    for (const row of chunk) {
      const col =
        row.scope === "menu" ? "menuItems" : row.scope === "category" ? "menuCategories" : "menuOptionGroups";
      batch.update(doc(db, col, row.id), { name: row.to, updatedAt: now });
    }
    await batch.commit();
  }

  // option choices: rewrite whole options array per group
  if (choices.length) {
    const groupsSnap = await getDocs(collection(db, "menuOptionGroups"));
    const byGroup = new Map();
    for (const c of choices) {
      if (!byGroup.has(c.groupId)) byGroup.set(c.groupId, []);
      byGroup.get(c.groupId).push(c);
    }
    const groupDocs = new Map(groupsSnap.docs.map((d) => [d.id, d]));
    const groupIds = [...byGroup.keys()];
    for (let i = 0; i < groupIds.length; i += 200) {
      const batch = writeBatch(db);
      for (const gid of groupIds.slice(i, i + 200)) {
        const snap = groupDocs.get(gid);
        if (!snap) continue;
        const data = snap.data() || {};
        const edits = new Map(byGroup.get(gid).map((e) => [e.choiceId, e.to]));
        const options = (data.options || []).map((o) => {
          if (!edits.has(o.id)) return o;
          return { ...o, name: edits.get(o.id) };
        });
        batch.update(doc(db, "menuOptionGroups", gid), { options, updatedAt: now });
      }
      await batch.commit();
    }
  }

  await bumpMenuVersion(db);
}

function printChannelInventory() {
  const channels = [
    scanChannelFile(join(DATA, "grab-live-scan.json"), "grab-menus"),
    scanChannelFile(join(DATA, "shopee-live-scan.json"), "shopee-menus"),
    scanChannelFile(join(DATA, "lineman-live-scan.json"), "lineman-menus"),
    scanChannelFile(join(DATA, "shopee-live-options.json"), "shopee-options"),
    scanChannelFile(join(DATA, "lineman-live-options.json"), "lineman-options"),
  ];
  // grab options nested in grab-live-scan
  const grabScan = existsSync(join(DATA, "grab-live-scan.json"))
    ? JSON.parse(readFileSync(join(DATA, "grab-live-scan.json"), "utf8"))
    : null;
  if (grabScan?.options) {
    const withParens = (grabScan.options || []).filter((o) => needsStrip(o.name));
    channels.push({
      kind: "grab-options",
      at: grabScan.scannedAt,
      total: grabScan.options.length,
      withParens: withParens.length,
      sample: withParens.slice(0, 8).map((o) => ({ from: o.name, to: stripParensName(o.name), group: o.group })),
    });
  }
  return channels;
}

async function main() {
  const db = await getSeedDb();
  const payload = await buildPosPlan(db);
  const channelInv = inventory || !apply ? printChannelInventory() : null;
  if (channelInv) payload.channels = channelInv.map(({ rows, ...rest }) => rest);

  writeFileSync(PLAN, JSON.stringify(payload, null, 2) + "\n");

  console.log(`=== POS strip-parens ${apply ? "APPLY" : "DRY-RUN"} ===`);
  console.log("scopes", payload.scopes);
  console.log("counts", payload.counts);
  if (payload.collisions.length) {
    console.log("COLLISIONS (blocked):");
    for (const c of payload.collisions) {
      console.log(`  → ${c.to}`);
      for (const r of c.rows) console.log(`     ${r.scope} ${r.id}: ${r.from}`);
    }
  }
  if (payload.externalCollisions.length) {
    console.log("EXTERNAL COLLISIONS (blocked):");
    for (const c of payload.externalCollisions) {
      console.log(`  ${c.id}: ${c.from} → ${c.to} conflicts ${c.conflictsWith}`);
    }
  }
  console.log(`plan ${payload.plan.length}:`);
  for (const r of payload.plan.slice(0, 40)) {
    console.log(`  [${r.scope}] ${r.from} → ${r.to}`);
  }
  if (payload.plan.length > 40) console.log(`  … +${payload.plan.length - 40} more`);

  if (channelInv) {
    console.log("\n=== Channel inventory (from last scan files) ===");
    for (const ch of channelInv) {
      if (ch.missing) {
        console.log(`  ${ch.kind}: missing file`);
        continue;
      }
      console.log(`  ${ch.kind}: ${ch.withParens}/${ch.total} with ()`);
    }
  }

  console.log(`\n→ ${PLAN}`);

  if (!apply) {
    console.log("Dry-run only — pass --apply to write Firestore + bump menuVersion");
    process.exit(0);
  }
  if (payload.collisions.length || payload.externalCollisions.length) {
    if (!payload.plan.length) {
      console.error("FAIL: collisions and empty plan — resolve manually");
      process.exit(2);
    }
    console.log("NOTE: applying non-colliding rows only");
  }
  if (!payload.plan.length) {
    console.log("Nothing to apply");
    process.exit(0);
  }

  await applyPlan(db, payload.plan);
  const log = { ...payload, apply: true, appliedAt: new Date().toISOString() };
  writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");
  writeFileSync(PLAN, JSON.stringify(log, null, 2) + "\n");
  console.log(`OK applied ${payload.plan.length} · menuVersion bumped → ${LOG}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
