#!/usr/bin/env node
/**
 * Parallel Grab price scan via Chrome tabs (open editor by name click).
 * Writes each verified live price into menuPriceHub/channelLive immediately.
 *
 *   node scripts/grab-chrome-scan.mjs [--workers=6] [--limit=N]
 *   node scripts/grab-chrome-scan.mjs --workers=4 --no-hub
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findGrabTab, openEditItem, mapPool } from "./lib/grab-chrome.mjs";
import { loadHubChannelContext } from "./lib/hub-channel-targets.mjs";
import { bestPosForGrab, isStoreOnlyName } from "./lib/name-sync-match.mjs";
import { normName } from "./lib/grab-csv.mjs";
import { writeHubChannelLiveRow } from "./lib/hub-live-write.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const SCAN = join(__dir, "data/menu-price-baseline/grab-live-scan.json");
const IDS = join(__dir, "data/menu-price-baseline/grab-item-ids.json");

function loadQueue() {
  if (existsSync(SCAN)) {
    const data = JSON.parse(readFileSync(SCAN, "utf8"));
    return (data.items || []).map((it) => ({
      name: it.name,
      itemId: it.itemId,
      category: it.category,
      status: it.status,
      listPrice: it.listPrice,
    }));
  }
  if (existsSync(IDS)) {
    const data = JSON.parse(readFileSync(IDS, "utf8"));
    return Object.entries(data.byId || {}).map(([itemId, v]) => ({
      name: v.name,
      itemId,
      category: v.category,
      status: "",
      listPrice: v.listPrice,
    }));
  }
  throw new Error("Missing grab-live-scan.json — run grab-ingest-export.mjs");
}

async function scanOne(tabIndex, item, _i, windowIndex) {
  const data = await openEditItem(tabIndex, item.itemId, item.name, windowIndex, item.category);
  if (data?.listPrice == null) {
    return {
      name: item.name,
      listPrice: item.listPrice ?? null,
      itemId: item.itemId,
      category: item.category,
      status: item.status,
      error: "read_fail",
    };
  }
  return {
    name: data.name || item.name,
    listPrice: data.listPrice,
    itemId: data.itemId || item.itemId,
    category: item.category,
    status: item.status,
    editUrl: data.url,
  };
}

function matchPos(name, items, posByName) {
  return bestPosForGrab(name, items) || posByName.get(normName(name)) || null;
}

async function main() {
  const workersArg = process.argv.find((a) => a.startsWith("--workers="));
  const workers = workersArg ? Math.min(10, Math.max(2, Number(workersArg.slice(10)))) : 6;
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const fromArg = process.argv.find((a) => a.startsWith("--from="));
  const noHub = process.argv.includes("--no-hub");
  const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : Infinity;
  const from = fromArg ? Number(fromArg.slice("--from=".length)) : 0;

  const fullQueue = loadQueue();
  const queue = fullQueue.slice(from, from + (Number.isFinite(limit) ? limit : 9999));
  console.log(`=== Grab scan ×${workers} tabs — ${queue.length} items${noHub ? "" : " · hub row-by-row"} ===`);
  findGrabTab();

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

  const prev = existsSync(SCAN) ? JSON.parse(readFileSync(SCAN, "utf8")) : { items: [], options: [] };
  const byId = new Map((prev.items || []).map((it) => [it.itemId, it]));

  const started = Date.now();
  let hubOk = 0;
  const results = await mapPool(queue, workers, async (tabIndex, item, i, windowIndex) => {
    const r = await scanOne(tabIndex, item, i, windowIndex);
    byId.set(r.itemId, { ...(byId.get(r.itemId) || {}), ...r });
    // persist scan incrementally so crash ไม่เสียทั้งรอบ
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
            options: prev.options || [],
          },
          null,
          2,
        ) + "\n",
      );
    }

    const price = Number(r.listPrice);
    if (!noHub && !r.error && Number.isFinite(price) && price > 0) {
      const pos = matchPos(r.name, posItems, posByName);
      if (pos?.id) {
        const ok = await writeHubChannelLiveRow({
          posId: pos.id,
          channel: "grab",
          name: r.name,
          price,
          scannedAt: new Date().toISOString(),
          externalId: r.itemId ? String(r.itemId) : null,
          source: "scan",
        });
        if (ok) {
          hubOk += 1;
          console.log(
            `[${i + 1}/${queue.length}] ${price} · ${String(r.name).slice(0, 36)} → hub G`,
          );
        } else {
          console.log(`[${i + 1}/${queue.length}] ${price} · ${String(r.name).slice(0, 36)} (hub fail)`);
        }
      } else {
        console.log(`[${i + 1}/${queue.length}] ${price} · ${String(r.name).slice(0, 36)} (no POS match)`);
      }
    } else {
      console.log(
        `[${i + 1}/${queue.length}] ${r.error || r.listPrice} · ${String(r.name).slice(0, 36)}`,
      );
    }
    return r;
  });

  const out = {
    scannedAt: new Date().toISOString(),
    method: `parallel-${workers}tabs`,
    elapsedSec: Math.round((Date.now() - started) / 1000),
    count: byId.size,
    items: [...byId.values()],
    options: prev.options || [],
  };
  writeFileSync(SCAN, JSON.stringify(out, null, 2) + "\n");
  const ok = results.filter((r) => r.listPrice != null && !r.error).length;
  console.log(
    `OK ${ok}/${results.length} this run · hub ${hubOk} · total store ${out.count} in ${out.elapsedSec}s → ${SCAN}`,
  );
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
