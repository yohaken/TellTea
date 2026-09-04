#!/usr/bin/env node
/**
 * Parallel LINE MAN (Wongnai) menu price scan via Chrome tabs.
 * Writes each verified live price into menuPriceHub/channelLive immediately.
 *
 *   node scripts/lineman-chrome-scan.mjs [--workers=6] [--limit=N] [--from=N]
 *   node scripts/lineman-chrome-scan.mjs --workers=6 --no-hub
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findWongnaiTab,
  chromeJsOnTab,
  readEditPage,
  sleep,
  mapPool,
  editUrl,
} from "./lib/lineman-chrome.mjs";
import { loadHubChannelContext } from "./lib/hub-channel-targets.mjs";
import { isStoreOnlyName } from "./lib/name-sync-match.mjs";
import { normName } from "./lib/grab-csv.mjs";
import { writeHubChannelLiveRow } from "./lib/hub-live-write.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const SCAN = join(__dir, "data/menu-price-baseline/lineman-live-scan.json");

async function scanOne(tabIndex, item, _i, windowIndex) {
  const href = item.href || editUrl(item.id);
  chromeJsOnTab(
    tabIndex,
    `(() => { location.href=${JSON.stringify(href)}; return 'ok'; })()`,
    { windowIndex },
  );
  await sleep(1200);
  let data = readEditPage(tabIndex, windowIndex);
  if (!data?.onEdit || data.listPrice == null) {
    await sleep(1000);
    data = readEditPage(tabIndex, windowIndex);
  }
  if (!data?.onEdit || data.listPrice == null) {
    return {
      id: item.id,
      name: item.name,
      href,
      category: item.category || "",
      listPrice: null,
      error: "read_fail",
    };
  }
  return {
    id: data.id || item.id,
    name: data.name || item.name,
    href: data.url || href,
    category: item.category || "",
    listPrice: data.listPrice,
    offlinePrice: data.offlinePrice ?? null,
    prices: data.prices || [],
  };
}

function matchPos(name, items, posByName) {
  // Exact full name only — never fuzzy (ชานม ≠ ชานมเผือก)
  void items;
  return posByName.get(normName(name)) || null;
}

async function main() {
  const workersArg = process.argv.find((a) => a.startsWith("--workers="));
  const workers = workersArg
    ? Math.min(10, Math.max(2, Number(workersArg.slice("--workers=".length))))
    : 6;
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const fromArg = process.argv.find((a) => a.startsWith("--from="));
  const noHub = process.argv.includes("--no-hub");
  const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : Infinity;
  const from = fromArg ? Number(fromArg.slice("--from=".length)) : 0;

  if (!existsSync(SCAN)) throw new Error(`Missing ${SCAN}`);
  const prev = JSON.parse(readFileSync(SCAN, "utf8"));
  const full = (prev.items || []).filter((it) => it.id);
  const queue = full.slice(from, from + (Number.isFinite(limit) ? limit : full.length));
  console.log(
    `=== LINE MAN scan ×${workers} — ${queue.length} items${noHub ? "" : " · hub row-by-row"} ===`,
  );
  findWongnaiTab();

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

  const byId = new Map((prev.items || []).map((it) => [it.id, it]));
  const started = Date.now();
  let hubOk = 0;

  const results = await mapPool(queue, workers, async (tabIndex, item, i, windowIndex) => {
    const r = await scanOne(tabIndex, item, i, windowIndex);
    byId.set(r.id, { ...(byId.get(r.id) || {}), ...r });

    if ((i + 1) % 10 === 0 || i === queue.length - 1) {
      writeFileSync(
        SCAN,
        JSON.stringify(
          {
            scannedAt: new Date().toISOString(),
            source: `wongnai parallel-${workers}tabs`,
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
          channel: "lineman",
          name: r.name,
          price,
          scannedAt: new Date().toISOString(),
          externalId: r.id != null ? String(r.id) : null,
          source: "scan",
        });
        if (ok) {
          hubOk += 1;
          console.log(
            `[${from + i + 1}/${full.length}] ${price} · ${String(r.name).slice(0, 36)} → hub L`,
          );
        } else {
          console.log(
            `[${from + i + 1}/${full.length}] ${price} · ${String(r.name).slice(0, 36)} (hub fail)`,
          );
        }
      } else {
        console.log(
          `[${from + i + 1}/${full.length}] ${price} · ${String(r.name).slice(0, 36)} (no POS match)`,
        );
      }
    } else {
      console.log(
        `[${from + i + 1}/${full.length}] ${r.error || "FAIL"} · ${String(r.name || "").slice(0, 36)}`,
      );
    }
    return r;
  });

  const out = {
    scannedAt: new Date().toISOString(),
    source: `wongnai parallel-${workers}tabs`,
    elapsedSec: Math.round((Date.now() - started) / 1000),
    count: byId.size,
    items: [...byId.values()],
  };
  writeFileSync(SCAN, JSON.stringify(out, null, 2) + "\n");
  const ok = results.filter((r) => r.listPrice != null && !r.error).length;
  console.log(
    `\nOK ${ok}/${results.length} · hub ${hubOk} · ${out.elapsedSec}s → ${SCAN}`,
  );
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
