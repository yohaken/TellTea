#!/usr/bin/env node
/**
 * Rename Shopee menus to match POS names (alias sync).
 *
 *   node scripts/shopee-chrome-rename-batch.mjs --dry-run --workers=6
 *   node scripts/shopee-chrome-rename-batch.mjs --apply --workers=6
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import {
  findShopeeTab,
  readEditPage,
  setNameOnTab,
  chromeJsOnTab,
  editUrl,
  sleep,
  mapPool,
  normName,
} from "./lib/shopee-chrome.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const BASELINE = join(__dir, "data/menu-price-baseline/shopee-baseline-2026-07-15.csv");
const POS = join(__dir, "data/menu-price-baseline/telltea-menu-prices-snapshot-2026-09-01.csv");
const LOG = join(__dir, "data/menu-price-baseline/shopee-rename-log.json");

function loadRenames() {
  const baseline = parse(readFileSync(BASELINE), { columns: true, skip_empty_lines: true });
  const pos = parse(readFileSync(POS), { columns: true, skip_empty_lines: true });
  const posByNorm = new Map(pos.map((p) => [normName(p.name), p.name]));

  return baseline
    .filter((b) => normName(b.shopeeName) !== normName(b.mainName))
    .map((b) => ({
      from: b.shopeeName,
      to: posByNorm.get(normName(b.mainName)) || b.mainName,
      dishId: String(b.shopeeCode || "").trim(),
    }))
    .filter((r) => r.dishId && /^\d+$/.test(r.dishId));
}

async function renameOne(tabIndex, item, apply, windowIndex) {
  chromeJsOnTab(tabIndex, `(() => { location.href='${editUrl(item.dishId)}'; return 'ok'; })()`, {
    windowIndex,
  });
  await sleep(1600);
  const before = readEditPage(tabIndex, windowIndex);
  if (!before?.onEdit) return { ...item, status: "error", error: "edit page not open" };
  if (normName(before.name) === normName(item.to)) {
    return { ...item, status: "skip", beforeName: before.name };
  }

  const result = setNameOnTab(tabIndex, item.to, apply, windowIndex);
  if (result?.skip) return { ...item, status: "skip", beforeName: result.before };
  if (result?.error) return { ...item, status: "error", error: result.error, beforeName: before.name };
  if (!apply) return { ...item, status: "dry-run", beforeName: result.before, afterName: result.after };

  await sleep(2800);
  const verify = readEditPage(tabIndex, windowIndex);
  const ok = normName(verify?.name) === normName(item.to);
  return {
    ...item,
    status: ok ? "renamed" : "verify_fail",
    beforeName: result.before,
    afterName: verify?.name,
  };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const workersArg = process.argv.find((a) => a.startsWith("--workers="));
  const workers = workersArg ? Math.min(10, Math.max(2, Number(workersArg.slice(10)))) : 6;

  const todo = loadRenames();
  console.log(`=== Shopee rename ×${workers} ${apply ? "APPLY" : "DRY-RUN"} — ${todo.length} items ===`);
  if (!todo.length) {
    console.log("No alias renames needed");
    return;
  }

  findShopeeTab();
  const started = Date.now();

  const log = await mapPool(todo, workers, async (tabIndex, item, i, windowIndex) => {
    const r = await renameOne(tabIndex, item, apply, windowIndex);
    console.log(
      `[${i + 1}/${todo.length}] ${r.status}: "${item.from.slice(0, 35)}" → "${item.to.slice(0, 35)}"`,
    );
    return { ...r, at: new Date().toISOString() };
  });

  writeFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), apply, log }, null, 2) + "\n");

  const ok = log.filter((r) => r.status === "renamed" || r.status === "skip" || r.status === "dry-run").length;
  console.log(`\nDone ${ok}/${todo.length} in ${Math.round((Date.now() - started) / 1000)}s → ${LOG}`);
  if (log.some((r) => r.status === "error" || r.status === "verify_fail")) process.exit(2);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
