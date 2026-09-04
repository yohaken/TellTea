#!/usr/bin/env node
/**
 * Parallel Shopee price scan via multiple Chrome tabs.
 *
 *   node scripts/shopee-chrome-scan.mjs [--workers=6] [--limit N] [--from N]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import {
  findShopeeTab,
  readEditPage,
  chromeJsOnTab,
  editUrl,
  sleep,
  mapPool,
} from "./lib/shopee-chrome.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const BASELINE_CSV = join(__dir, "data/menu-price-baseline/shopee-baseline-2026-07-15.csv");
const DEFAULT_OUT = join(__dir, "data/menu-price-baseline/shopee-live-scan.json");
const ID_CACHE = join(__dir, "data/menu-price-baseline/shopee-dish-ids.json");

function loadNames() {
  return parse(readFileSync(BASELINE_CSV), { columns: true, skip_empty_lines: true }).map(
    (r) => r.shopeeName,
  );
}

function loadIdCache() {
  const byName = {};
  // Seed from baseline CSV (รหัสเมนู = dish id)
  const rows = parse(readFileSync(BASELINE_CSV), { columns: true, skip_empty_lines: true });
  for (const r of rows) {
    const code = String(r.shopeeCode || "").trim();
    if (code && /^\d+$/.test(code)) byName[r.shopeeName] = code;
  }
  if (existsSync(ID_CACHE)) {
    try {
      Object.assign(byName, JSON.parse(readFileSync(ID_CACHE, "utf8")).byName || {});
    } catch {
      /* ignore */
    }
  }
  return byName;
}

function saveIdCache(byName) {
  writeFileSync(
    ID_CACHE,
    JSON.stringify({ updatedAt: new Date().toISOString(), byName }, null, 2) + "\n",
  );
}

async function scanOne(tabIndex, name, _i, windowIndex, idCache) {
  const dishId = idCache[name];
  if (!dishId) {
    return { name, listPrice: null, displayPrice: null, prices: [], error: "no_dish_id" };
  }

  chromeJsOnTab(tabIndex, `(() => { location.href='${editUrl(dishId)}'; return 'ok'; })()`, {
    windowIndex,
  });
  await sleep(1400);
  const data = readEditPage(tabIndex, windowIndex);
  if (!data?.onEdit || data.listPrice == null) {
    return { name, listPrice: null, displayPrice: null, prices: [], dishId, error: "read_fail" };
  }
  return {
    name,
    listPrice: data.listPrice,
    displayPrice: data.listPrice,
    prices: [data.listPrice],
    dishId: data.dishId || dishId,
    editUrl: data.url,
  };
}

async function main() {
  const workersArg = process.argv.find((a) => a.startsWith("--workers="));
  const workers = workersArg ? Math.min(10, Math.max(2, Number(workersArg.slice(10)))) : 6;
  const outArg = process.argv.find((a) => a.startsWith("--out="));
  const outPath = outArg ? outArg.slice("--out=".length) : DEFAULT_OUT;
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const fromArg = process.argv.find((a) => a.startsWith("--from="));
  const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : Infinity;
  const from = fromArg ? Number(fromArg.slice("--from=".length)) : 0;

  const names = loadNames();
  const slice = names.slice(from, from + (Number.isFinite(limit) ? limit : names.length));
  const idCache = loadIdCache();

  console.log(`=== Shopee scan ×${workers} tabs — ${slice.length} items ===`);
  findShopeeTab();

  const started = Date.now();
  const results = await mapPool(
    slice,
    workers,
    async (tabIndex, name, i, windowIndex) => {
      const r = await scanOne(tabIndex, name, i, windowIndex, idCache);
      const tag = r.listPrice != null ? `฿${r.listPrice}` : "NOT FOUND";
      console.log(`[${from + i + 1}/${names.length}] ${name.slice(0, 42)} → ${tag}`);
      return r;
    },
  );

  saveIdCache(idCache);

  let merged = results;
  if (from > 0 && existsSync(outPath)) {
    try {
      const prior = JSON.parse(readFileSync(outPath, "utf8")).items || [];
      merged = [...prior.slice(0, from), ...results];
    } catch {
      merged = results;
    }
  }

  writeFileSync(
    outPath,
    JSON.stringify(
      {
        scannedAt: new Date().toISOString(),
        method: `parallel-${workers}tabs`,
        elapsedSec: Math.round((Date.now() - started) / 1000),
        count: merged.length,
        items: merged,
      },
      null,
      2,
    ) + "\n",
  );

  const ok = results.filter((r) => r.listPrice != null).length;
  console.log(`\nOK ${ok}/${slice.length} in ${Math.round((Date.now() - started) / 1000)}s → ${outPath}`);
  console.log(`Dish ID cache → ${ID_CACHE}`);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
