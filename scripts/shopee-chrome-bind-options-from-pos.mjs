#!/usr/bin/env node
/**
 * Bind POS option groups onto Shopee dishes that lost them (or have fewer).
 * POS หลังร้าน is the source of truth. Does not change price / photo / listing.
 *
 *   node scripts/shopee-chrome-bind-options-from-pos.mjs --dry-run
 *   node scripts/shopee-chrome-bind-options-from-pos.mjs --apply
 *   node scripts/shopee-chrome-bind-options-from-pos.mjs --apply --only=ชานม
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
import { writeHubChannelLiveRow } from "./lib/hub-live-write.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const LOG = join(__dir, "data/menu-price-baseline/shopee-bind-options-from-pos-log.json");
const DISH_API = "https://foody.shopee.co.th/api/seller/store/dishes";
const OG_API = "https://foody.shopee.co.th/api/seller/store/option-groups";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const dryRun = !apply || args.includes("--dry-run");
const only = (args.find((a) => a.startsWith("--only=")) || "").slice(7).trim();
const limit = Number((args.find((a) => a.startsWith("--limit=")) || "").slice(8)) || 0;
const workers = Math.max(1, Math.min(6, Number((args.find((a) => a.startsWith("--workers=")) || "").slice(10)) || 5));

function fold(s) {
  return normName(s)
    .replace(/\u00a0/g, " ")
    .replace(/ท้อปปิ้ง/g, "ท็อปปิ้ง");
}

function xhrOnTab(tabIndex, windowIndex, url) {
  return chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const x = new XMLHttpRequest();
      x.open('GET', ${JSON.stringify(url)}, false);
      x.withCredentials = true;
      x.setRequestHeader('Content-Type', 'application/json');
      x.send(null);
      return JSON.stringify({ status: x.status, body: x.responseText });
    })()`,
    { windowIndex },
  );
}

function getJson(tabIndex, windowIndex, url) {
  const r = xhrOnTab(tabIndex, windowIndex, url);
  try {
    return JSON.parse(r.body);
  } catch {
    return { error: true, raw: String(r?.body || "").slice(0, 500) };
  }
}

function mapGroupIds(optionNames, shopeeGroups) {
  const mapped = [];
  const missing = [];
  for (const name of optionNames) {
    const hit = shopeeGroups.find((g) => fold(g.name) === fold(name) || namesEqual(g.name, name));
    if (hit) mapped.push({ name, id: String(hit.id) });
    else missing.push(name);
  }
  return { mapped, missing };
}

async function bindOptionsUi(tabIndex, windowIndex, dishId, optionNames) {
  chromeJsOnTab(
    tabIndex,
    `(() => { location.href=${JSON.stringify(editUrl(dishId))}; return 'ok'; })()`,
    { windowIndex },
  );
  let ready = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 10000) {
    await sleep(400);
    ready = chromeJsJsonOnTab(
      tabIndex,
      `JSON.stringify({
        url: location.href,
        onEdit: location.href.includes('/dish/edit'),
        cbs: document.querySelectorAll('input[type="checkbox"]').length
      })`,
      { windowIndex },
    );
    if (ready?.onEdit && Number(ready.cbs) >= 8) break;
  }
  if (!ready?.onEdit || Number(ready.cbs) < 8) {
    return { ok: false, reason: "edit-not-ready", url: ready?.url, after: null, missed: optionNames, cbs: ready?.cbs };
  }
  chromeJsOnTab(
    tabIndex,
    `(() => {
      const names = ${JSON.stringify(optionNames)};
      const fold = (s) => String(s || '').replace(/\\u00a0/g,' ').replace(/ท้อปปิ้ง/g,'ท็อปปิ้ง').replace(/\\s+/g,' ').trim().toLowerCase();
      for (const name of names) {
        for (const tr of document.querySelectorAll('tr')) {
          const first = (tr.innerText || '').trim().split('\\n')[0].trim();
          if (fold(first) !== fold(name)) continue;
          const label = tr.querySelector('label.shopee-pos-checkbox-wrapper') || tr.querySelector('label');
          const cb = tr.querySelector('input[type="checkbox"]');
          try { tr.scrollIntoView({ block: 'center' }); } catch (e) {}
          if (cb && !cb.checked) (label || cb).click();
          break;
        }
      }
      return 'ticked';
    })()`,
    { windowIndex },
  );
  await sleep(600);
  const ticked = chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const names = ${JSON.stringify(optionNames)};
      const fold = (s) => String(s || '').replace(/\\u00a0/g,' ').replace(/ท้อปปิ้ง/g,'ท็อปปิ้ง').replace(/\\s+/g,' ').trim().toLowerCase();
      const done = [];
      const missed = [];
      for (const name of names) {
        let hit = false;
        for (const tr of document.querySelectorAll('tr')) {
          const first = (tr.innerText || '').trim().split('\\n')[0].trim();
          if (fold(first) !== fold(name)) continue;
          const cb = tr.querySelector('input[type="checkbox"]');
          const wrap = tr.querySelector('.shopee-pos-checkbox');
          const checked = !!cb?.checked || /checked/i.test(wrap?.className || '');
          hit = checked;
          done.push({ name, checked });
          break;
        }
        if (!hit) missed.push(name);
      }
      return JSON.stringify({ done, missed });
    })()`,
    { windowIndex },
  );
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
  await sleep(800);
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
  const after = getJson(tabIndex, windowIndex, `${DISH_API}/${dishId}`);
  const count = after?.data?.dish?.option_group_count ?? null;
  const missed = ticked?.missed || [];
  return {
    ok: !!save?.ok && !missed.length && Number(count) >= optionNames.length,
    ticked,
    save,
    after: count,
    missed,
  };
}

function catRank(cat) {
  if (/ชานม \(เย็น/.test(cat)) return 0;
  if (/ชานมสดคราฟต์/.test(cat)) return 1;
  if (/Signature/.test(cat)) return 2;
  if (/^ชา$/.test(cat) || cat === "ชา") return 3;
  if (/ชาผลไม้/.test(cat)) return 4;
  if (/นม \(เย็น/.test(cat)) return 5;
  if (/กาแฟ \(เย็น/.test(cat)) return 6;
  return 10;
}

async function loadPos() {
  const db = await getSeedDb();
  const [itemsSnap, catsSnap, groupsSnap] = await Promise.all([
    getDocs(collection(db, "menuItems")),
    getDocs(collection(db, "menuCategories")),
    getDocs(collection(db, "menuOptionGroups")),
  ]);
  const cats = new Map();
  for (const d of catsSnap.docs) cats.set(d.id, d.data()?.name || d.id);
  const groups = new Map();
  for (const d of groupsSnap.docs) {
    const g = d.data() || {};
    groups.set(d.id, { name: g.name || "", active: g.active !== false });
  }
  const items = itemsSnap.docs
    .map((d) => {
      const data = d.data() || {};
      const ids = Array.isArray(data.optionGroupIds) ? data.optionGroupIds : [];
      const optionNames = ids
        .map((id) => groups.get(id))
        .filter((g) => g && g.active)
        .map((g) => g.name);
      return {
        id: d.id,
        name: data.name || "",
        active: data.active !== false,
        storeOnly: data.storeOnly === true || isStoreOnlyName(data.name || ""),
        category: cats.get(data.categoryId) || "",
        optionNames,
        price: Number(data.price) || 0,
      };
    })
    .filter((p) => p.active && !p.storeOnly && p.optionNames.length);
  return items;
}

async function main() {
  const { windowIndex, tabIndex } = findShopeeTab();
  const posItems = await loadPos();
  const list = getJson(tabIndex, windowIndex, DISH_API);
  const catalogs = list.data?.catalogs || [];
  const liveItems = [];
  for (const c of catalogs) {
    for (const d of c.dishes || []) {
      liveItems.push({
        id: String(d.id),
        name: d.name || "",
        cat: c.name || "",
        catalogId: String(c.id),
        count: Number(d.option_group_count) || 0,
        listing: d.listing_status,
        available: d.available,
        price: d.price,
        list_price: d.list_price,
      });
    }
  }
  const og = getJson(tabIndex, windowIndex, OG_API);
  const shopeeGroups = (og.data?.groups || []).map((g) => ({
    id: String(g.group_id),
    name: g.group_name || "",
  }));

  const liveByName = new Map();
  for (const it of liveItems) {
    if (/^\s*ลบไม่ได้/.test(it.name)) continue;
    if (it.listing === 0 || it.available === false) continue;
    if (!liveByName.has(normName(it.name))) liveByName.set(normName(it.name), it);
  }

  let rows = [];
  for (const pos of posItems) {
    if (only && !pos.name.includes(only) && !pos.category.includes(only)) continue;
    const live = liveByName.get(normName(pos.name));
    if (!live) continue;
    const { mapped, missing } = mapGroupIds(pos.optionNames, shopeeGroups);
    if (!mapped.length) continue;
    if (live.count >= mapped.length && !missing.length) continue;
    rows.push({
      posId: pos.id,
      name: pos.name,
      category: pos.category,
      dishId: live.id,
      catalogId: live.catalogId,
      liveCount: live.count,
      want: mapped.length,
      optionNames: mapped.map((m) => m.name),
      optionGroupIds: mapped.map((m) => m.id),
      missing,
      livePrice: live.price,
      liveListPrice: live.list_price,
    });
  }
  rows.sort((a, b) => catRank(a.category) - catRank(b.category) || a.name.localeCompare(b.name, "th"));
  if (limit) rows = rows.slice(0, limit);

  console.log(
    JSON.stringify(
      {
        dryRun,
        shopeeGroups: shopeeGroups.length,
        todo: rows.length,
        byCat: Object.fromEntries(
          [...rows.reduce((m, r) => m.set(r.category, (m.get(r.category) || 0) + 1), new Map())],
        ),
      },
      null,
      2,
    ),
  );
  for (const r of rows) {
    console.log(
      `  ${r.category}\t${r.name}\t${r.liveCount}→${r.want}\t${r.optionNames.join(" · ")}${r.missing.length ? " · missing " + r.missing.join(",") : ""}`,
    );
  }
  if (dryRun) {
    writeFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), dryRun: true, rows }, null, 2) + "\n");
    process.exit(0);
  }

  console.log(`\nUI bind ×${workers} · ${rows.length} dishes`);
  const results = await mapPool(rows, workers, async (ti, row, _i, wi) => {
    console.log(`  bind ${row.name}`);
    const ui = await bindOptionsUi(ti, wi, row.dishId, row.optionNames);
    const result = {
      status: ui.ok ? "ok" : "fail",
      before: row.liveCount,
      after: ui.after,
      missed: ui.missed || [],
      reason: ui.reason || "",
    };
    console.log(
      `    ${row.name} ${row.liveCount}→${ui.after} ${result.status}${result.missed.length ? " missed " + result.missed.join(",") : ""}`,
    );
    return { ...row, result };
  });
  const merged = results.filter(Boolean);
  const ok = merged.filter((r) => r.result.status === "ok" && Number(r.result.after) >= r.want);
  const fail = merged.filter((r) => !(r.result.status === "ok" && Number(r.result.after) >= r.want));
  console.log(`\nbound ${ok.length}/${merged.length} · fail ${fail.length}`);
  for (const r of fail) {
    console.log(`  FAIL ${r.name} ${r.liveCount}→${r.result.after} ${r.result.status} ${r.result.reason || ""}`);
  }

  for (const r of ok) {
    const live = liveByName.get(normName(r.name));
    const priceRaw = Number(live?.list_price || live?.price || 0);
    const price = priceRaw >= 1000 ? Math.round(priceRaw / 100_000) : priceRaw;
    await writeHubChannelLiveRow({
      posId: r.posId,
      channel: "shopee",
      name: r.name,
      price,
      externalId: r.dishId,
      source: "bind-options",
      groupNames: r.optionNames,
      category: r.category,
      applyStatus: "options_bound",
      applyNote: `opts ${r.result.before}→${r.result.after}`,
    });
  }

  writeFileSync(
    LOG,
    JSON.stringify({ at: new Date().toISOString(), dryRun: false, ok: ok.length, fail: fail.length, merged }, null, 2) +
      "\n",
  );
  process.exit(fail.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
