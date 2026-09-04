#!/usr/bin/env node
/**
 * Ingest Grab Merchant CSV export → grab-live-scan.json + grab-item-ids.json
 *
 *   node scripts/grab-ingest-export.mjs
 *   node scripts/grab-ingest-export.mjs --csv path/to/export.csv
 */
import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadGrabExportCsv, toLiveScan } from "./lib/grab-csv.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dir, "data/menu-price-baseline");
const DEFAULT_CSV = join(DATA, "grab-export-2026-09-01.csv");
const OUT_SCAN = join(DATA, "grab-live-scan.json");
const OUT_IDS = join(DATA, "grab-item-ids.json");

function main() {
  const csvArg = process.argv.find((a) => a.startsWith("--csv="));
  const csvPath = csvArg ? csvArg.slice("--csv=".length) : DEFAULT_CSV;
  if (!existsSync(csvPath)) throw new Error(`CSV not found: ${csvPath}`);

  if (csvPath !== DEFAULT_CSV) {
    copyFileSync(csvPath, DEFAULT_CSV);
    console.log(`Copied → ${DEFAULT_CSV}`);
  }

  const parsed = loadGrabExportCsv(csvPath);
  const scan = toLiveScan(parsed, { source: "grab-csv-export" });
  writeFileSync(OUT_SCAN, JSON.stringify(scan, null, 2) + "\n");

  const byName = {};
  const byId = {};
  for (const it of parsed.items) {
    byName[it.name] = it.itemId;
    byId[it.itemId] = { name: it.name, listPrice: it.listPrice, category: it.category };
  }
  writeFileSync(
    OUT_IDS,
    JSON.stringify({ updatedAt: new Date().toISOString(), byName, byId }, null, 2) + "\n",
  );

  console.log(`OK items ${scan.count} · option keys ${scan.options.length}`);
  console.log(`→ ${OUT_SCAN}`);
  console.log(`→ ${OUT_IDS}`);
}

main();
