#!/usr/bin/env node
/**
 * Ingest Shopee Partner "ดาวน์โหลดเมนู" ZIP → live scan JSON.
 *
 *   node scripts/shopee-ingest-export.mjs
 *   node scripts/shopee-ingest-export.mjs --zip=/path/to/ดาวน์โหลดเมนู_….zip
 *
 * Then: node scripts/channel-scan-to-hub.mjs --channel=shopee
 */
import { copyFileSync, existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadShopeeExportZip, toLiveScan, toLiveOptions } from "./lib/shopee-csv.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dir, "data/menu-price-baseline");
const OUT_SCAN = join(DATA, "shopee-live-scan.json");
const OUT_OPTS = join(DATA, "shopee-live-options.json");
const OUT_IDS = join(DATA, "shopee-dish-ids.json");
const DEFAULT_COPY = join(DATA, "shopee-export-latest.zip");

function findLatestZip() {
  const dir = join(process.env.HOME || "", "Downloads");
  let best = existsSync(DEFAULT_COPY)
    ? { p: DEFAULT_COPY, t: statSync(DEFAULT_COPY).mtimeMs }
    : null;
  if (existsSync(dir)) {
    for (const n of readdirSync(dir)) {
      if (!n.startsWith("ดาวน์โหลดเมนู_") || !n.endsWith(".zip")) continue;
      const p = join(dir, n);
      const t = statSync(p).mtimeMs;
      if (!best || t > best.t) best = { p, t };
    }
  }
  return best?.p || null;
}

function main() {
  const zipArg = process.argv.find((a) => a.startsWith("--zip="));
  const zipPath = zipArg ? zipArg.slice("--zip=".length) : findLatestZip();
  if (!zipPath || !existsSync(zipPath)) {
    throw new Error("Missing Shopee ZIP — pass --zip= or download จากปุ่มดาวน์โหลดเมนู");
  }

  const parsed = loadShopeeExportZip(zipPath);
  const scan = toLiveScan(parsed);
  const opts = toLiveOptions(parsed);
  writeFileSync(OUT_SCAN, JSON.stringify(scan, null, 2) + "\n");
  writeFileSync(OUT_OPTS, JSON.stringify(opts, null, 2) + "\n");

  const byName = {};
  for (const it of parsed.items) {
    if (it.name && it.dishId) byName[it.name] = it.dishId;
  }
  writeFileSync(
    OUT_IDS,
    JSON.stringify({ updatedAt: parsed.scannedAt, byName }, null, 2) + "\n",
  );

  if (zipPath !== DEFAULT_COPY) copyFileSync(zipPath, DEFAULT_COPY);

  console.log(`OK menus ${scan.count} · options ${opts.options.length}`);
  console.log(`← ${zipPath}`);
  console.log(`→ ${OUT_SCAN}`);
  console.log(`→ ${OUT_OPTS}`);
}

main();
