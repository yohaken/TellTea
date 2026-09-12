#!/usr/bin/env node
/**
 * Scan Shopee live dishes + bound option group names (multi-tab).
 * Writes scripts/data/menu-price-baseline/shopee-live-scan.json
 *
 *   node scripts/shopee-chrome-scan-dish-options.mjs
 *   node scripts/shopee-chrome-scan-dish-options.mjs --workers=5
 *   node scripts/shopee-chrome-scan-dish-options.mjs --api-only
 *     # store/dishes list only (name/price/picture/sort/category) — keep prior optionGroupNames
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findShopeeTab,
  chromeJsJsonOnTab,
  chromeJsOnTab,
  editUrl,
  sleep,
  mapPool,
} from "./lib/shopee-chrome.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const SCAN = join(__dir, "data/menu-price-baseline/shopee-live-scan.json");
const DISH_API = "https://foody.shopee.co.th/api/seller/store/dishes";
const workers = Math.max(1, Math.min(6, Number((process.argv.find((a) => a.startsWith("--workers=")) || "").slice(10)) || 5));

function bahtFromMicros(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n >= 1000) return Math.round(n / 100_000);
  return Math.round(n);
}

function getJson(tabIndex, windowIndex, url) {
  const r = chromeJsJsonOnTab(
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
  try {
    return JSON.parse(r.body);
  } catch {
    return {};
  }
}

async function readBoundGroups(tabIndex, windowIndex, dishId) {
  chromeJsOnTab(
    tabIndex,
    `(() => { location.href=${JSON.stringify(editUrl(dishId))}; return 'ok'; })()`,
    { windowIndex },
  );
  const t0 = Date.now();
  let ready = null;
  while (Date.now() - t0 < 9000) {
    await sleep(350);
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
    return { ok: false, names: [] };
  }
  const read = chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const names = [];
      for (const tr of document.querySelectorAll('tr')) {
        const cb = tr.querySelector('input[type="checkbox"]');
        const wrap = tr.querySelector('.shopee-pos-checkbox');
        const checked = !!cb?.checked || /checked/i.test(wrap?.className || '');
        if (!checked) continue;
        const first = (tr.innerText || '').trim().split('\\n')[0].trim();
        if (!first || first === 'ชื่อกลุ่มตัวเลือกเสริม' || /^เลือก/.test(first)) continue;
        names.push(first);
      }
      return JSON.stringify({ names });
    })()`,
    { windowIndex },
  );
  return { ok: true, names: read?.names || [] };
}

async function main() {
  const { windowIndex, tabIndex } = findShopeeTab();
  const list = getJson(tabIndex, windowIndex, DISH_API);
  const catalogs = list.data?.catalogs || [];
  const items = [];
  for (const c of catalogs) {
    for (const [i, d] of (c.dishes || []).entries()) {
      items.push({
        name: d.name || "",
        listPrice: bahtFromMicros(d.price ?? d.list_price),
        dishId: String(d.id),
        category: c.name || "",
        listing_status: d.listing_status,
        available: d.available,
        picture: d.picture || "",
        option_group_count: Number(d.option_group_count) || 0,
        sales_volume: d.sales_volume,
        sortIndex: i,
        catalogRank: c.rank,
        optionGroupNames: [],
      });
    }
  }
  const existing = (() => {
    try {
      return JSON.parse(readFileSync(SCAN, "utf8"));
    } catch {
      return null;
    }
  })();
  const apiOnly = process.argv.includes("--api-only");
  const retryEmpty = process.argv.includes("--retry-empty");

  // Preserve previously scraped option group names when we only refresh the API list.
  if (existing?.items?.length) {
    const prevById = new Map(existing.items.map((x) => [String(x.dishId), x]));
    for (const it of items) {
      const prev = prevById.get(String(it.dishId));
      if (prev?.optionGroupNames?.length) it.optionGroupNames = prev.optionGroupNames;
    }
  }

  if (apiOnly) {
    writeFileSync(
      SCAN,
      JSON.stringify(
        {
          scannedAt: new Date().toISOString(),
          method: "api-store-dishes-only",
          count: items.length,
          scraped: 0,
          scrapeFail: 0,
          items,
        },
        null,
        2,
      ) + "\n",
    );
    const withPic = items.filter((it) => it.picture).length;
    console.log(`Shopee API dishes ${items.length} · pictures ${withPic} (api-only)`);
    console.log(`wrote ${SCAN}`);
    return;
  }

  let need = items.filter(
    (it) =>
      it.option_group_count > 0 &&
      it.listing_status === 1 &&
      !/^\s*ลบไม่ได้/.test(it.name),
  );
  if (retryEmpty && existing?.items) {
    const empty = new Set(
      existing.items
        .filter((x) => (x.option_group_count || 0) > 0 && !(x.optionGroupNames || []).length && !/^\s*ลบไม่ได้/.test(x.name || ""))
        .map((x) => String(x.dishId)),
    );
    need = items.filter((it) => empty.has(it.dishId));
    for (const it of items) {
      const prev = existing.items.find((x) => String(x.dishId) === it.dishId);
      if (prev?.optionGroupNames?.length) it.optionGroupNames = prev.optionGroupNames;
    }
  }
  console.log(`dishes ${items.length} · scrape bound groups ${need.length} ×${workers}`);
  const scraped = await mapPool(need, workers, async (ti, it, _i, wi) => {
    const got = await readBoundGroups(ti, wi, it.dishId);
    const names = got.names || [];
    console.log(`  ${it.name}  ${it.option_group_count} · ${names.join(" · ") || "(none)"}`);
    return { dishId: it.dishId, names, ok: got.ok };
  });
  const byId = new Map((scraped || []).map((x) => [String(x.dishId), x]));
  for (const it of items) {
    const hit = byId.get(it.dishId);
    if (hit?.names?.length) it.optionGroupNames = hit.names;
  }
  const fail = (scraped || []).filter((x) => !x.ok || x.names.length === 0);
  writeFileSync(
    SCAN,
    JSON.stringify(
      {
        scannedAt: new Date().toISOString(),
        method: "api-store-dishes + edit-page bound groups",
        count: items.length,
        scraped: need.length,
        scrapeFail: fail.length,
        items,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`wrote ${SCAN} · scrape fail ${fail.length}/${need.length}`);
  for (const f of fail.slice(0, 12)) console.log(`  FAIL ${f.dishId}`);
  process.exit(fail.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
