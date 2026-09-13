#!/usr/bin/env node
/**
 * Reorder Shopee dish-bound option groups to match POS optionGroupIds order.
 * Method: edit page → untick bound groups → tick in POS order (+ keep Shopee-only extras first) → save.
 * Verifies via GET /api/seller/dishes/:id/option-groups ranks.
 *
 *   node scripts/shopee-chrome-reorder-options-to-pos.mjs --dry-run
 *   node scripts/shopee-chrome-reorder-options-to-pos.mjs --apply
 *   node scripts/shopee-chrome-reorder-options-to-pos.mjs --apply --only=โซดา --workers=4
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collection, getDocs } from "firebase/firestore";
import { getSeedDb } from "./lib/pos-firebase-seed.mjs";
import { namesEqual, normName } from "./lib/grab-csv.mjs";
import { isStoreOnlyName } from "./lib/name-sync-match.mjs";
import {
  findShopeeTab,
  chromeJsJsonOnTab,
  chromeJsOnTab,
  editUrl,
  sleep,
  mapPool,
} from "./lib/shopee-chrome.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const LOG = join(__dir, "data/menu-price-baseline/shopee-reorder-options-to-pos-log.json");
const DISH_API = "https://foody.shopee.co.th/api/seller/store/dishes";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const only = (args.find((a) => a.startsWith("--only=")) || "").slice(7).trim();
const limit = Number((args.find((a) => a.startsWith("--limit=")) || "").slice(8)) || 0;
const workers = Math.max(1, Math.min(5, Number((args.find((a) => a.startsWith("--workers=")) || "").slice(10)) || 4));

function fold(s) {
  return normName(s)
    .replace(/\u00a0/g, " ")
    .replace(/ท้อปปิ้ง/g, "ท็อปปิ้ง");
}

function xhrJson(tabIndex, windowIndex, method, url, body) {
  return chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const x = new XMLHttpRequest();
      x.open(${JSON.stringify(method)}, ${JSON.stringify(url)}, false);
      x.withCredentials = true;
      x.setRequestHeader('Content-Type', 'application/json');
      x.send(${body == null ? "null" : JSON.stringify(JSON.stringify(body))});
      return x.responseText || JSON.stringify({ status: x.status, error: 'empty' });
    })()`,
    { windowIndex },
  );
}

function liveGroupNames(tabIndex, windowIndex, dishId) {
  const j = xhrJson(
    tabIndex,
    windowIndex,
    "GET",
    `https://foody.shopee.co.th/api/seller/dishes/${dishId}/option-groups`,
    null,
  );
  const groups = j?.data?.groups || [];
  return groups
    .slice()
    .sort((a, b) => (a.rank || 0) - (b.rank || 0))
    .map((g) => g.group_name || "")
    .filter(Boolean);
}

function orderWrong(posNames, liveNames) {
  if (!posNames.length) return false;
  if (!liveNames?.length) return true;
  const used = new Set();
  const idxs = [];
  for (const p of posNames) {
    const idx = liveNames.findIndex((ln, i) => !used.has(i) && namesEqual(p, ln));
    if (idx < 0) return true; // missing — treat as need fix (bind+order)
    used.add(idx);
    idxs.push(idx);
  }
  for (let i = 1; i < idxs.length; i++) if (idxs[i] < idxs[i - 1]) return true;
  return false;
}

/** Extras (Shopee-only, e.g. ประเภท / โปรโมชั่น) stay first; then POS order. */
function desiredOrder(posNames, liveNames) {
  const extras = (liveNames || []).filter((ln) => !posNames.some((p) => namesEqual(p, ln)));
  return [...extras, ...posNames];
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
  const isToppingCat = (name) => /ท็?อ?ปปิ้ง|ท้อปปิ้ง|ทัอปปิ้ง|topping/i.test(String(name || ""));
  return itemsSnap.docs
    .map((d) => {
      const data = d.data() || {};
      const ids = Array.isArray(data.optionGroupIds) ? data.optionGroupIds : [];
      return {
        name: data.name || "",
        active: data.active !== false,
        storeOnly: data.storeOnly === true || isStoreOnlyName(data.name || ""),
        category: catName.get(data.categoryId) || "",
        optionNames: ids.map((id) => groups.get(id)).filter(Boolean),
      };
    })
    .filter((p) => p.active && !p.storeOnly && !isToppingCat(p.category) && p.optionNames.length);
}

async function reorderUi(tabIndex, windowIndex, dishId, wantNames) {
  chromeJsOnTab(
    tabIndex,
    `(() => { location.href=${JSON.stringify(editUrl(dishId))}; return 'ok'; })()`,
    { windowIndex },
  );
  const t0 = Date.now();
  let ready = null;
  while (Date.now() - t0 < 12000) {
    await sleep(400);
    ready = chromeJsJsonOnTab(
      tabIndex,
      `JSON.stringify({
        onEdit: location.href.includes('/dish/edit'),
        cbs: document.querySelectorAll('input[type="checkbox"]').length
      })`,
      { windowIndex },
    );
    if (ready?.onEdit && Number(ready.cbs) >= 8) break;
  }
  if (!ready?.onEdit || Number(ready.cbs) < 8) {
    return { ok: false, reason: "edit-not-ready", ready, before: [], after: [] };
  }

  const toggle = async (name, shouldCheck) => {
    return chromeJsJsonOnTab(
      tabIndex,
      `(() => {
        const fold = (s) => String(s || '').replace(/\\u00a0/g,' ').replace(/ท้อปปิ้ง/g,'ท็อปปิ้ง').replace(/\\s+/g,' ').trim().toLowerCase();
        const want = fold(${JSON.stringify(name)});
        for (const tr of document.querySelectorAll('table tr')) {
          const first = (tr.innerText || '').trim().split('\\n')[0].trim();
          if (fold(first) !== want) continue;
          const cb = tr.querySelector('input[type=checkbox]');
          const wrap = tr.querySelector('.shopee-pos-checkbox');
          const label = tr.querySelector('label.shopee-pos-checkbox-wrapper') || tr.querySelector('label');
          const checked = !!cb?.checked || /checked/i.test(wrap?.className || '');
          try { tr.scrollIntoView({ block: 'center' }); } catch (e) {}
          if (checked !== ${JSON.stringify(!!shouldCheck)}) (label || cb)?.click();
          return JSON.stringify({ name: first, target: ${JSON.stringify(!!shouldCheck)}, was: checked });
        }
        return JSON.stringify({ name: ${JSON.stringify(name)}, miss: true });
      })()`,
      { windowIndex },
    );
  };

  const beforeLive = liveGroupNames(tabIndex, windowIndex, dishId);
  for (const name of beforeLive) {
    await toggle(name, false);
    await sleep(280);
  }
  await sleep(500);
  for (const name of wantNames) {
    await toggle(name, true);
    await sleep(320);
  }
  await sleep(400);

  const save = chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === 'บันทึก');
      if (!btn) return JSON.stringify({ ok: false, reason: 'no-save' });
      btn.click();
      return JSON.stringify({ ok: true });
    })()`,
    { windowIndex },
  );
  await sleep(900);
  chromeJsOnTab(
    tabIndex,
    `(() => {
      const dialog = [...document.querySelectorAll('[class*=modal], [class*=dialog], [class*=confirm]')]
        .find((e) => /บันทึกแทนที่|อัปเดตข้อมูล/i.test(e.innerText || ''));
      if (!dialog) return 'none';
      const ok = [...dialog.querySelectorAll('button')].find((b) => /ตกลง|OK|ยืนยัน/i.test((b.innerText || '').trim()));
      if (ok) ok.click();
      return ok ? 'confirmed' : 'dialog';
    })()`,
    { windowIndex },
  );
  await sleep(2800);

  const after = liveGroupNames(tabIndex, windowIndex, dishId);
  const posInWant = wantNames.filter((n) => after.some((a) => namesEqual(a, n)));
  const allPresent = wantNames.every((n) => after.some((a) => namesEqual(a, n)));
  const okOrder = !orderWrong(posInWant, after);

  return {
    ok: !!save?.ok && allPresent && okOrder,
    save,
    before: beforeLive,
    after,
    want: wantNames,
  };
}

async function main() {
  const { windowIndex, tabIndex } = findShopeeTab();
  const posItems = await loadPos();
  const list = xhrJson(tabIndex, windowIndex, "GET", DISH_API, null);
  const liveItems = [];
  for (const c of list?.data?.catalogs || []) {
    for (const d of c.dishes || []) {
      liveItems.push({
        id: String(d.id),
        name: d.name || "",
        cat: c.name || "",
        count: Number(d.option_group_count) || 0,
      });
    }
  }

  console.log("building plan (fetch bound ranks)…");
  const plan = [];
  for (const pos of posItems) {
    if (only && !pos.name.includes(only)) continue;
    const live = liveItems.find((l) => namesEqual(l.name, pos.name));
    if (!live || live.count === 0) continue;
    const liveNames = liveGroupNames(tabIndex, windowIndex, live.id);
    if (!orderWrong(pos.optionNames, liveNames)) continue;
    const want = desiredOrder(pos.optionNames, liveNames);
    plan.push({
      dishId: live.id,
      name: pos.name,
      cat: live.cat,
      before: liveNames,
      pos: pos.optionNames,
      want,
    });
  }

  const queue = limit ? plan.slice(0, limit) : plan;
  console.log(`plan ${plan.length} · run ${queue.length} · ${apply ? "APPLY" : "dry-run"} · workers ${workers}`);
  for (const row of queue.slice(0, 25)) {
    console.log(`  ${row.name}`);
    console.log(`    ${row.before.join(" → ")}`);
    console.log(`    → ${row.want.join(" → ")}`);
  }
  if (queue.length > 25) console.log(`  … +${queue.length - 25}`);

  let results = [];
  if (apply) {
    results = await mapPool(queue, workers, async (ti, row, i, wi) => {
      console.log(`[${i + 1}/${queue.length}] ${row.name}`);
      const res = await reorderUi(ti, wi, row.dishId, row.want);
      console.log(`  ${res.ok ? "ok" : "FAIL"} ${(res.after || []).join(" → ")}`);
      return { ...row, ...res };
    });
    const ok = results.filter((r) => r.ok).length;
    console.log(`done ${ok}/${results.length} ok`);
  }

  writeFileSync(
    LOG,
    JSON.stringify({ at: new Date().toISOString(), apply, planned: plan.length, plan, results }, null, 2) + "\n",
  );
  console.log(`→ ${LOG}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("FAIL:", e.message || e);
  process.exit(1);
});
