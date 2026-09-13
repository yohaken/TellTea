#!/usr/bin/env node
/**
 * Attach missing Grab modifier groups to match POS optionGroupIds (presence first).
 * Upsert-item often ignores linkedModifierGroupIDs — this uses the edit UI checkboxes.
 *
 *   node scripts/grab-chrome-attach-missing-options-from-pos.mjs --dry-run
 *   node scripts/grab-chrome-attach-missing-options-from-pos.mjs --apply
 *   node scripts/grab-chrome-attach-missing-options-from-pos.mjs --apply --only=ลาเต้
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collection, getDocs } from "firebase/firestore";
import { getSeedDb } from "./lib/pos-firebase-seed.mjs";
import { namesEqual, normName } from "./lib/grab-csv.mjs";
import { isStoreOnlyName } from "./lib/name-sync-match.mjs";
import {
  findGrabTab,
  fetchGrabMenuApi,
  chromeJsJsonOnTab,
  openEditItem,
  sleep,
} from "./lib/grab-chrome.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const LOG = join(__dir, "data/menu-price-baseline/grab-attach-missing-options-log.json");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const only = (args.find((a) => a.startsWith("--only=")) || "").slice(7).trim();

function fold(s) {
  return normName(s || "");
}

async function loadPos() {
  const db = await getSeedDb();
  const [itemsSnap, catsSnap, groupsSnap] = await Promise.all([
    getDocs(collection(db, "menuItems")),
    getDocs(collection(db, "menuCategories")),
    getDocs(collection(db, "menuOptionGroups")),
  ]);
  const catName = new Map(catsSnap.docs.map((d) => [d.id, d.data()?.name || ""]));
  const groups = new Map();
  for (const d of groupsSnap.docs) {
    const g = d.data() || {};
    if (g.active === false) continue;
    groups.set(d.id, g.name || "");
  }
  return itemsSnap.docs
    .map((d) => {
      const data = d.data() || {};
      const ids = Array.isArray(data.optionGroupIds) ? data.optionGroupIds : [];
      return {
        name: data.name || "",
        active: data.active !== false,
        storeOnly: data.storeOnly === true || isStoreOnlyName(data.name || ""),
        categoryName: catName.get(data.categoryId) || "",
        optionNames: ids.map((id) => groups.get(id)).filter(Boolean),
      };
    })
    .filter((i) => i.active && !i.storeOnly && i.categoryName !== "ทัอปปิ้ง");
}

function flattenGrab(menu) {
  const items = [];
  const groupById = new Map();
  for (const g of menu.modifierGroups || []) {
    const id = g.modifierGroupID || g.modifierGroupId;
    if (id) groupById.set(id, g.modifierGroupName || g.name || "");
  }
  for (const c of menu.categories || []) {
    const catName = c.categoryName || c.name || "";
    for (const it of c.items || []) {
      const linked = it.linkedModifierGroupIDs || [];
      items.push({
        itemID: it.itemID,
        name: it.itemName || it.name || "",
        categoryName: catName,
        groupNames: linked.map((id) => groupById.get(id)).filter(Boolean),
      });
    }
  }
  return items;
}

async function attachGroups(tabIndex, windowIndex, names) {
  if (!names.length) return { skipped: true };
  const payload = JSON.stringify(names);
  return chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const want = ${payload};
      const fold = (s) => String(s || '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
      const out = [];
      for (const name of want) {
        let hit = null;
        for (const lab of document.querySelectorAll('label, div, span')) {
          const t = fold(lab.innerText || '').split('\\n')[0];
          if (t === fold(name)) { hit = lab; break; }
        }
        if (!hit) { out.push({ name, ok: false, why: 'no-label' }); continue; }
        const inp = hit.querySelector('input[type=checkbox]')
          || hit.closest('label')?.querySelector('input[type=checkbox]');
        if (inp) {
          if (!inp.checked) inp.click();
          out.push({ name, ok: true, checked: true });
        } else {
          hit.click();
          out.push({ name, ok: true, clicked: true });
        }
      }
      const save = [...document.querySelectorAll('button')].find((b) => /^บันทึก/.test((b.innerText || '').trim()));
      if (save && !save.disabled) save.click();
      return JSON.stringify({ ticks: out, saved: !!save });
    })()`,
    { windowIndex },
  );
}

async function main() {
  const { windowIndex, tabIndex } = findGrabTab();
  const posItems = await loadPos();
  const grab = flattenGrab(fetchGrabMenuApi(tabIndex, windowIndex));

  const plan = [];
  for (const pos of posItems) {
    if (only && !pos.name.includes(only)) continue;
    const live = grab.find((g) => namesEqual(g.name, pos.name));
    if (!live) continue;
    const missing = pos.optionNames.filter(
      (n) => !live.groupNames.some((ln) => namesEqual(n, ln)),
    );
    if (!missing.length) continue;
    plan.push({
      name: pos.name,
      grabId: live.itemID,
      category: pos.categoryName,
      live: live.groupNames,
      pos: pos.optionNames,
      attach: missing,
    });
  }

  console.log(`plan ${plan.length} · ${apply ? "APPLY" : "dry-run"}`);
  for (const row of plan) {
    console.log(`  ${row.name}`);
    console.log(`    live ${row.live.join(" → ") || "(none)"}`);
    console.log(`    + ${row.attach.join(" | ")}`);
  }

  const results = [];
  if (apply) {
    for (let i = 0; i < plan.length; i++) {
      const row = plan[i];
      console.log(`\n[${i + 1}/${plan.length}] ${row.name}`);
      const page = await openEditItem(
        tabIndex,
        row.grabId,
        row.name,
        windowIndex,
        row.category,
      );
      if (!page) {
        results.push({ ...row, ok: false, why: "edit_fail" });
        continue;
      }
      await sleep(1200);
      const ticks = await attachGroups(tabIndex, windowIndex, row.attach);
      console.log("  attach", ticks);
      await sleep(2200);
      results.push({ name: row.name, grabId: row.grabId, attach: row.attach, ticks });
    }
  }

  writeFileSync(
    LOG,
    JSON.stringify({ at: new Date().toISOString(), apply, planned: plan.length, plan, results }, null, 2) +
      "\n",
  );
  console.log(`→ ${LOG}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("FAIL:", e.message || e);
  process.exit(1);
});
