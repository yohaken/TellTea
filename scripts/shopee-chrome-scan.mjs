#!/usr/bin/env node
/**
 * Parallel Shopee price scan via multiple Chrome tabs.
 * Writes each verified live price into menuPriceHub/channelLive (Shopee only).
 *
 *   node scripts/shopee-chrome-scan.mjs [--workers=6] [--limit=N] [--from=N]
 *   node scripts/shopee-chrome-scan.mjs --workers=10 --no-hub
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
import { loadHubChannelContext } from "./lib/hub-channel-targets.mjs";
import { isStoreOnlyName } from "./lib/name-sync-match.mjs";
import { normName } from "./lib/grab-csv.mjs";
import { writeHubChannelLiveRow } from "./lib/hub-live-write.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const BASELINE_CSV = join(__dir, "data/menu-price-baseline/shopee-baseline-2026-07-15.csv");
const SCAN = join(__dir, "data/menu-price-baseline/shopee-live-scan.json");
const ID_CACHE = join(__dir, "data/menu-price-baseline/shopee-dish-ids.json");
const TRACKER = join(__dir, "data/menu-price-baseline/shopee-price-tracker.json");

function loadIdCache() {
  const byName = {};
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

function loadQueue(idCache) {
  if (existsSync(SCAN)) {
    try {
      const data = JSON.parse(readFileSync(SCAN, "utf8"));
      const items = (data.items || []).filter((it) => it.dishId || it.name);
      if (items.length) {
        return items.map((it) => ({
          name: it.name,
          dishId: it.dishId || idCache[it.name] || null,
          category: it.category || "",
          visible: it.visible || "",
          stock: it.stock || "",
          listPrice: it.listPrice ?? null,
        }));
      }
    } catch {
      /* fall through */
    }
  }
  return parse(readFileSync(BASELINE_CSV), { columns: true, skip_empty_lines: true }).map((r) => ({
    name: r.shopeeName,
    dishId: idCache[r.shopeeName] || String(r.shopeeCode || "").trim() || null,
    category: "",
    visible: "",
    stock: "",
    listPrice: null,
  }));
}

function matchPos(name, items, posByName) {
  void items;
  return posByName.get(normName(name)) || null;
}

async function scanOne(tabIndex, item, _i, windowIndex) {
  const dishId = item.dishId;
  if (!dishId) {
    return { ...item, listPrice: null, displayPrice: null, prices: [], error: "no_dish_id" };
  }

  chromeJsOnTab(tabIndex, `(() => { location.href='${editUrl(dishId)}'; return 'ok'; })()`, {
    windowIndex,
  });
  await sleep(1400);
  let data = readEditPage(tabIndex, windowIndex);
  if (!data?.onEdit || data.listPrice == null) {
    await sleep(1200);
    data = readEditPage(tabIndex, windowIndex);
  }
  if (!data?.onEdit || data.listPrice == null) {
    return {
      ...item,
      listPrice: null,
      displayPrice: null,
      prices: [],
      dishId,
      error: "read_fail",
    };
  }
  return {
    ...item,
    name: data.name || item.name,
    listPrice: data.listPrice,
    displayPrice: data.listPrice,
    prices: [data.listPrice],
    dishId: data.dishId || dishId,
    editUrl: data.url,
  };
}

function syncTrackerLive(results) {
  if (!existsSync(TRACKER)) return 0;
  const tracker = JSON.parse(readFileSync(TRACKER, "utf8"));
  let n = 0;
  for (const r of results) {
    if (r.listPrice == null || !Number.isFinite(Number(r.listPrice))) continue;
    const key = r.dishId || r.name;
    const entry = tracker.items?.[key] || tracker.items?.[r.name];
    if (!entry) continue;
    entry.currentLive = Number(r.listPrice);
    entry.reachedTarget = entry.currentLive === entry.targetPrice;
    n++;
  }
  tracker.updatedAt = new Date().toISOString();
  writeFileSync(TRACKER, JSON.stringify(tracker, null, 2) + "\n");
  return n;
}

async function main() {
  const workersArg = process.argv.find((a) => a.startsWith("--workers="));
  const workers = workersArg ? Math.min(10, Math.max(1, Number(workersArg.slice("--workers=".length)))) : 6;
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const fromArg = process.argv.find((a) => a.startsWith("--from="));
  const noHub = process.argv.includes("--no-hub");
  const retryFail = process.argv.includes("--retry-fail");
  const lastLog = process.argv.includes("--last-log");
  const pendingOnly = process.argv.includes("--pending");
  const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : Infinity;
  const from = fromArg ? Number(fromArg.slice("--from=".length)) : 0;

  const idCache = loadIdCache();
  let fullQueue = loadQueue(idCache);
  if (lastLog) {
    const LOG = join(__dir, "data/menu-price-baseline/shopee-update-log.json");
    const log = JSON.parse(readFileSync(LOG, "utf8"));
    const ids = new Set((log.log || []).map((r) => String(r.dishId || "")).filter(Boolean));
    const names = new Set((log.log || []).map((r) => r.name).filter(Boolean));
    fullQueue = fullQueue.filter((it) => ids.has(String(it.dishId || "")) || names.has(it.name));
  } else if (pendingOnly && existsSync(TRACKER)) {
    const tracker = JSON.parse(readFileSync(TRACKER, "utf8"));
    const ids = new Set(
      Object.values(tracker.items || {})
        .filter((i) => i.currentLive !== i.targetPrice)
        .map((i) => String(i.dishId || "")),
    );
    fullQueue = fullQueue.filter((it) => ids.has(String(it.dishId || "")));
  }
  const filtered = retryFail
    ? fullQueue.filter((it) => it.listPrice == null || !Number.isFinite(Number(it.listPrice)))
    : fullQueue;
  const queue = filtered.slice(from, from + (Number.isFinite(limit) ? limit : filtered.length));

  console.log(
    `=== Shopee scan ×${workers} tabs — ${queue.length} items${noHub ? "" : " · hub row-by-row"} ===`,
  );
  findShopeeTab();

  let posItems = [];
  let posByName = new Map();
  if (!noHub) {
    const ctx = await loadHubChannelContext();
    posItems = (ctx.items || []).filter((p) => !p.storeOnly && !isStoreOnlyName(p.name || ""));
    for (const it of posItems) {
      const n = normName(it.name);
      if (n) posByName.set(n, it);
    }
  }

  const prev = existsSync(SCAN) ? JSON.parse(readFileSync(SCAN, "utf8")) : { items: [] };
  const byId = new Map(
    (prev.items || [])
      .filter((it) => it.dishId)
      .map((it) => [String(it.dishId), it]),
  );

  const started = Date.now();
  let hubOk = 0;
  const results = await mapPool(queue, workers, async (tabIndex, item, i, windowIndex) => {
    const r = await scanOne(tabIndex, item, i, windowIndex);
    if (r.dishId) {
      byId.set(String(r.dishId), { ...(byId.get(String(r.dishId)) || {}), ...r });
      if (r.name) idCache[r.name] = String(r.dishId);
    }

    if ((i + 1) % 10 === 0 || i === queue.length - 1) {
      writeFileSync(
        SCAN,
        JSON.stringify(
          {
            scannedAt: new Date().toISOString(),
            method: `parallel-${workers}tabs`,
            elapsedSec: Math.round((Date.now() - started) / 1000),
            count: byId.size,
            items: [...byId.values()],
          },
          null,
          2,
        ) + "\n",
      );
    }

    const price = Number(r.listPrice);
    if (!noHub && !r.error && Number.isFinite(price) && price >= 0) {
      const pos = matchPos(r.name, posItems, posByName);
      if (pos?.id) {
        const ok = await writeHubChannelLiveRow({
          posId: pos.id,
          channel: "shopee",
          name: r.name,
          price,
          scannedAt: new Date().toISOString(),
          externalId: r.dishId ? String(r.dishId) : null,
          source: "scan",
        });
        if (ok) {
          hubOk += 1;
          console.log(
            `[${from + i + 1}/${fullQueue.length}] ${price} · ${String(r.name).slice(0, 36)} → hub S`,
          );
        } else {
          console.log(
            `[${from + i + 1}/${fullQueue.length}] ${price} · ${String(r.name).slice(0, 36)} (hub fail)`,
          );
        }
      } else {
        console.log(
          `[${from + i + 1}/${fullQueue.length}] ${price} · ${String(r.name).slice(0, 36)} (no POS match)`,
        );
      }
    } else {
      console.log(
        `[${from + i + 1}/${fullQueue.length}] ${r.error || "FAIL"} · ${String(r.name || "").slice(0, 36)}`,
      );
    }
    return r;
  });

  saveIdCache(idCache);

  const out = {
    scannedAt: new Date().toISOString(),
    method: `parallel-${workers}tabs`,
    elapsedSec: Math.round((Date.now() - started) / 1000),
    count: byId.size,
    items: [...byId.values()],
  };
  writeFileSync(SCAN, JSON.stringify(out, null, 2) + "\n");
  const trackerN = syncTrackerLive(results);
  const ok = results.filter((r) => r.listPrice != null && !r.error).length;
  console.log(
    `\nOK ${ok}/${results.length} · hub ${hubOk} · tracker ${trackerN} · ${out.elapsedSec}s → ${SCAN}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FAIL:", e.message);
    process.exit(1);
  });
