#!/usr/bin/env node
/**
 * Reorder Grab linkedModifierGroupIDs (+ move wrong category) to match POS.
 * Uses POST /food/merchant/v2/upsert-item — no separate group-sort API.
 *
 *   node scripts/grab-reorder-option-groups-to-pos.mjs --dry-run
 *   node scripts/grab-reorder-option-groups-to-pos.mjs --apply
 *   node scripts/grab-reorder-option-groups-to-pos.mjs --apply --limit=20
 *   node scripts/grab-reorder-option-groups-to-pos.mjs --apply --only=ชาเขียว
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
  chromeJsOnTab as grabOn,
  chromeJsJsonOnTab as grabJson,
  sleep,
  GRAB_STORE_ID,
} from "./lib/grab-chrome.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const LOG = join(__dir, "data/menu-price-baseline/grab-reorder-option-groups-log.json");
const GRAB_GROUP_FALLBACK = "4-C6J1BCNXTYKTLX";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const only = (args.find((a) => a.startsWith("--only=")) || "").slice(7).trim();
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.slice(8)) : Infinity;

function fold(s) {
  return normName(s || "");
}

function withGrabNameTranslation(item) {
  const cur = item?.nameTranslation?.translation || {};
  const name = String(item?.itemName || "").trim();
  const fill = (v) => String(v || "").trim() || name;
  return {
    ...item,
    nameTranslation: {
      translation: {
        ...cur,
        en: fill(cur.en),
        zh: fill(cur.zh),
        ko: fill(cur.ko),
      },
      originalTranslationFromDS: item?.nameTranslation?.originalTranslationFromDS ?? null,
    },
  };
}

function grabHeadersJs() {
  return `{
    const merchantID = ${JSON.stringify(GRAB_STORE_ID)};
    let merchantGroupID = ${JSON.stringify(GRAB_GROUP_FALLBACK)};
    try {
      const sel = JSON.parse(localStorage.getItem('merchantSelector') || '[]');
      if (sel[0]?.id) merchantGroupID = sel[0].id;
    } catch {}
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      requestSource: 'troyPortal',
      'x-grabkit-clientid': 'grabmerchant-portal',
      'x-client-id': 'GrabMerchant-Portal',
      merchantID,
      merchantGroupID,
    };
  }`;
}

async function waitWindowKey(read, timeoutMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await sleep(400);
    const st = read();
    if (st && st !== "pending" && st?.stage !== "upsert") return st;
  }
  return { ok: false, stage: "timeout" };
}

/**
 * Reorder POS-matched groups to POS order, keep Grab-only extras in their slots
 * (e.g. ประเภท stays first when POS has no matching group).
 */
function desiredLinkedIds(posGroupNames, liveIds, _groupById, groupByFoldName) {
  const posIdOrder = [];
  const posIdSet = new Set();
  for (const name of posGroupNames) {
    const g = groupByFoldName.get(fold(name));
    const id = g?.modifierGroupID;
    if (!id || !liveIds.includes(id) || posIdSet.has(id)) continue;
    posIdSet.add(id);
    posIdOrder.push(id);
  }
  const result = [];
  let pi = 0;
  for (const id of liveIds) {
    if (posIdSet.has(id)) {
      if (pi < posIdOrder.length) result.push(posIdOrder[pi++]);
    } else {
      result.push(id);
    }
  }
  while (pi < posIdOrder.length) result.push(posIdOrder[pi++]);
  return result;
}

function sameIds(a, b) {
  return JSON.stringify(a || []) === JSON.stringify(b || []);
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
    groups.set(d.id, { id: d.id, name: g.name || "" });
  }
  const items = itemsSnap.docs
    .map((d) => {
      const data = d.data() || {};
      const optionGroupIds = Array.isArray(data.optionGroupIds) ? data.optionGroupIds : [];
      return {
        id: d.id,
        name: data.name || "",
        active: data.active !== false,
        storeOnly: data.storeOnly === true || isStoreOnlyName(data.name || ""),
        categoryName: catName.get(data.categoryId) || "",
        optionGroupIds,
        optionNames: optionGroupIds.map((id) => groups.get(id)?.name).filter(Boolean),
        sortOrder: data.sortOrder ?? 0,
      };
    })
    .filter((i) => i.active && !i.storeOnly);
  return { items, catName };
}

function flattenGrab(menu) {
  const items = [];
  const catsByName = new Map();
  for (const c of menu.categories || []) {
    const catName = c.categoryName || c.name || "";
    catsByName.set(fold(catName), { id: c.categoryID, name: catName });
    for (const it of c.items || []) {
      items.push({
        ...it,
        categoryID: it.categoryID || c.categoryID,
        categoryName: catName,
      });
    }
  }
  const groupById = new Map();
  const groupByFoldName = new Map();
  for (const g of menu.modifierGroups || []) {
    const id = g.modifierGroupID || g.modifierGroupId;
    if (!id) continue;
    groupById.set(id, g);
    groupByFoldName.set(fold(g.modifierGroupName || g.name || ""), g);
  }
  return { items, catsByName, groupById, groupByFoldName };
}

async function upsertItem(tabIndex, windowIndex, liveItem, linkedIds, categoryID) {
  const { attributes, attributeForm, ...rest } = withGrabNameTranslation({
    ...liveItem,
    linkedModifierGroupIDs: linkedIds,
    categoryID,
  });
  void attributes;
  void attributeForm;
  const slimKey = `__ttGrabReorderItem_${liveItem.itemID}`;
  const key = `__ttGrabReorderUp_${Date.now()}_${String(liveItem.itemID).slice(-6)}`;
  const slimJson = JSON.stringify(rest);
  const chunk = 24000;
  grabOn(tabIndex, `(() => { window[${JSON.stringify(slimKey)}] = ''; return 'ok'; })()`, {
    windowIndex,
  });
  for (let i = 0; i < slimJson.length; i += chunk) {
    grabOn(
      tabIndex,
      `(() => { window[${JSON.stringify(slimKey)}] += ${JSON.stringify(slimJson.slice(i, i + chunk))}; return window[${JSON.stringify(slimKey)}].length; })()`,
      { windowIndex },
    );
  }
  grabOn(
    tabIndex,
    `(() => {
      const key = ${JSON.stringify(key)};
      window[key] = 'pending';
      (async () => {
        const headers = (() => ${grabHeadersJs()})();
        let base = {};
        try { base = JSON.parse(window[${JSON.stringify(slimKey)}] || '{}'); } catch (e) {
          window[key] = { ok: false, stage: 'item-json', error: String(e) }; return;
        }
        if (!base.nameTranslation?.translation?.en) {
          window[key] = { ok: false, stage: 'nameTranslation' }; return;
        }
        const upsert = await fetch('https://api.grab.com/food/merchant/v2/upsert-item', {
          method: 'POST', credentials: 'include', headers,
          body: JSON.stringify({ item: base, categoryID: ${JSON.stringify(categoryID)} }),
        });
        window[key] = {
          ok: upsert.status >= 200 && upsert.status < 300,
          status: upsert.status,
          text: (await upsert.text()).slice(0, 500),
        };
      })().catch((e) => { window[${JSON.stringify(key)}] = { error: String(e) }; });
      return 'started';
    })()`,
    { windowIndex },
  );
  return waitWindowKey(() =>
    grabJson(tabIndex, `(() => JSON.stringify(window[${JSON.stringify(key)}] ?? null))()`, {
      windowIndex,
    }),
  );
}

function applyGrabItemsSort(tabIndex, windowIndex, categoryID, wantIds) {
  const sorts = wantIds.map((id, i) => ({ resourceID: id, sortOrder: i }));
  const raw = grabOn(
    tabIndex,
    `(() => {
      const x = new XMLHttpRequest();
      x.open('PUT', 'https://api.grab.com/food/merchant/items-sort', false);
      x.withCredentials = true;
      x.setRequestHeader('Content-Type', 'application/json');
      x.setRequestHeader('merchantID', ${JSON.stringify(GRAB_STORE_ID)});
      x.send(JSON.stringify({ categoryID: ${JSON.stringify(categoryID)}, sorts: ${JSON.stringify(sorts)} }));
      return x.status + '\\n' + (x.responseText || '').slice(0, 200);
    })()`,
    { windowIndex },
  );
  const status = Number(String(raw || "").split("\n")[0]);
  return status === 204 || status === 200;
}

async function main() {
  const { windowIndex, tabIndex } = findGrabTab();
  const { items: posItems } = await loadPos();
  let menu = fetchGrabMenuApi(tabIndex, windowIndex);
  let grab = flattenGrab(menu);

  const plan = [];
  for (const pos of posItems) {
    if (only && !pos.name.includes(only)) continue;
    const live = grab.items.find((g) => namesEqual(g.itemName || g.name || "", pos.name));
    if (!live) continue;
    const wantIds = desiredLinkedIds(
      pos.optionNames,
      live.linkedModifierGroupIDs || [],
      grab.groupById,
      grab.groupByFoldName,
    );
    const wantCat = grab.catsByName.get(fold(pos.categoryName));
    const catMove =
      wantCat?.id &&
      live.categoryID &&
      wantCat.id !== live.categoryID &&
      !namesEqual(live.categoryName || "", pos.categoryName);
    const groupsNeed = !sameIds(wantIds, live.linkedModifierGroupIDs || []);
    if (!groupsNeed && !catMove) continue;
    plan.push({
      posId: pos.id,
      name: pos.name,
      grabId: live.itemID,
      fromCat: live.categoryName,
      toCat: pos.categoryName,
      toCatId: wantCat?.id || live.categoryID,
      beforeGroups: (live.linkedModifierGroupIDs || []).map(
        (id) => grab.groupById.get(id)?.modifierGroupName || id,
      ),
      afterGroups: wantIds.map((id) => grab.groupById.get(id)?.modifierGroupName || id),
      wantIds,
      groupsNeed,
      catMove: !!catMove,
      live,
    });
  }

  console.log(
    `plan ${plan.length} (groups / category) · ${apply ? "APPLY" : "dry-run"}${only ? ` · only=${only}` : ""}`,
  );
  for (const row of plan.slice(0, 20)) {
    console.log(
      `  ${row.catMove ? "CAT" : "   "} ${row.groupsNeed ? "GRP" : "   "} ${row.name.slice(0, 42)}`,
    );
    if (row.catMove) console.log(`    cat ${row.fromCat} → ${row.toCat}`);
    if (row.groupsNeed) {
      console.log(`    ${row.beforeGroups.join(" → ")}`);
      console.log(`    → ${row.afterGroups.join(" → ")}`);
    }
  }
  if (plan.length > 20) console.log(`  … +${plan.length - 20}`);

  const results = [];
  if (apply) {
    let n = 0;
    for (const row of plan) {
      if (n >= limit) break;
      n += 1;
      const up = await upsertItem(
        tabIndex,
        windowIndex,
        row.live,
        row.wantIds,
        row.toCatId,
      );
      const ok = !!up?.ok;
      console.log(
        `[${n}/${Math.min(plan.length, limit)}] ${ok ? "ok" : "FAIL"} ${row.name.slice(0, 36)} ${up?.status || up?.stage || ""}`,
      );
      results.push({ name: row.name, grabId: row.grabId, ok, up, catMove: row.catMove, groupsNeed: row.groupsNeed });
      await sleep(350);
    }

    // refresh + reorder items in cats we touched
    menu = fetchGrabMenuApi(tabIndex, windowIndex);
    grab = flattenGrab(menu);
    const touchedCats = new Set(plan.map((p) => fold(p.toCat)).filter(Boolean));
    for (const catFold of touchedCats) {
      const cat = grab.catsByName.get(catFold);
      if (!cat?.id) continue;
      const posInCat = posItems
        .filter((p) => fold(p.categoryName) === catFold)
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.name.localeCompare(b.name, "th"));
      const liveInCat = grab.items.filter((g) => namesEqual(g.categoryName || "", cat.name));
      const want = [];
      const used = new Set();
      for (const p of posInCat) {
        const hit = liveInCat.find(
          (g) => !used.has(g.itemID) && namesEqual(g.itemName || "", p.name),
        );
        if (!hit) continue;
        used.add(hit.itemID);
        want.push(hit.itemID);
      }
      for (const g of liveInCat) {
        if (!used.has(g.itemID)) want.push(g.itemID);
      }
      if (want.length < 2) continue;
      const ok = applyGrabItemsSort(tabIndex, windowIndex, cat.id, want);
      console.log(`items-sort ${cat.name}: ${ok ? "ok" : "FAIL"} (${want.length})`);
    }
  }

  const out = {
    at: new Date().toISOString(),
    apply,
    planned: plan.length,
    results,
  };
  writeFileSync(LOG, JSON.stringify(out, null, 2) + "\n");
  console.log(`→ ${LOG}`);
}

main().catch((e) => {
  console.error("FAIL:", e.message || e);
  process.exit(1);
});
