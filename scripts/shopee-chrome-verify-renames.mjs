#!/usr/bin/env node
/** Verify Shopee renames + update baseline CSV + live scan */
import { readFileSync, writeFileSync } from "node:fs";
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
  normName,
} from "./lib/shopee-chrome.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const LOG = join(__dir, "data/menu-price-baseline/shopee-rename-log.json");
const BASELINE = join(__dir, "data/menu-price-baseline/shopee-baseline-2026-07-15.csv");
const SCAN = join(__dir, "data/menu-price-baseline/shopee-live-scan.json");

function updateBaselineCsv(byCode) {
  const raw = readFileSync(BASELINE, "utf8");
  const rows = parse(raw, { columns: true, skip_empty_lines: true });
  let updated = 0;
  for (const r of rows) {
    const newName = byCode[r.shopeeCode];
    if (newName && normName(r.shopeeName) !== normName(newName)) {
      r.shopeeName = newName;
      updated++;
    }
  }
  const header = Object.keys(rows[0]);
  const lines = [
    header.join(","),
    ...rows.map((r) =>
      header
        .map((h) => {
          const v = String(r[h] ?? "");
          return v.includes(",") || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v;
        })
        .join(","),
    ),
  ];
  writeFileSync(BASELINE, lines.join("\n") + "\n");
  return updated;
}

async function main() {
  const log = JSON.parse(readFileSync(LOG, "utf8"));
  const items = log.log.map((r) => ({ to: r.to, dishId: r.dishId, from: r.from }));

  console.log(`=== Verify ${items.length} renames on Shopee ===`);
  findShopeeTab();
  const results = await mapPool(items, 6, async (tabIndex, item, i, windowIndex) => {
    chromeJsOnTab(tabIndex, `(() => { location.href='${editUrl(item.dishId)}'; return 'ok'; })()`, {
      windowIndex,
    });
    await sleep(1400);
    const page = readEditPage(tabIndex, windowIndex);
    const ok = normName(page?.name) === normName(item.to);
    console.log(`[${i + 1}/${items.length}] ${ok ? "OK" : "FAIL"}: ${page?.name || "?"}`);
    return { ...item, liveName: page?.name, ok };
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\nVerify: ${results.filter((r) => r.ok).length}/${results.length} OK`);
  if (failed.length) {
    failed.forEach((f) => console.log("  expected:", f.to, "| got:", f.liveName));
    process.exit(2);
  }

  const byId = Object.fromEntries(log.log.map((r) => [r.dishId, r.to]));
  const scan = JSON.parse(readFileSync(SCAN, "utf8"));
  for (const it of scan.items) {
    if (it.dishId && byId[it.dishId]) it.name = byId[it.dishId];
  }
  scan.verifiedRenameAt = new Date().toISOString();
  writeFileSync(SCAN, JSON.stringify(scan, null, 2) + "\n");

  const updated = updateBaselineCsv(byId);
  console.log(`Baseline CSV: ${updated} rows updated`);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
