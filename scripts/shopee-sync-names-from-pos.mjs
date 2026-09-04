#!/usr/bin/env node
/**
 * Sync Shopee menu names → match POS (only where names differ).
 * Does NOT touch prices.
 *
 *   node scripts/shopee-sync-names-from-pos.mjs              # dry-run: list mismatches
 *   node scripts/shopee-sync-names-from-pos.mjs --apply      # rename on Shopee + verify + sheet
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
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
const SCAN = join(__dir, "data/menu-price-baseline/shopee-live-scan.json");
const LOG = join(__dir, "data/menu-price-baseline/shopee-rename-log.json");

function loadPairs() {
  const baseline = parse(readFileSync(BASELINE), { columns: true, skip_empty_lines: true });
  const pos = parse(readFileSync(POS), { columns: true, skip_empty_lines: true });
  const posByNorm = new Map(
    pos.filter((p) => p.active === "true" || p.active === true).map((p) => [normName(p.name), p.name]),
  );

  return baseline
    .map((b) => ({
      dishId: String(b.shopeeCode || "").trim(),
      posName: posByNorm.get(normName(b.mainName)) || b.mainName,
    }))
    .filter((r) => r.dishId && /^\d+$/.test(r.dishId));
}

async function readLiveNames(pairs, workers) {
  findShopeeTab();
  return mapPool(pairs, workers, async (tabIndex, item, i, windowIndex) => {
    chromeJsOnTab(tabIndex, `(() => { location.href='${editUrl(item.dishId)}'; return 'ok'; })()`, {
      windowIndex,
    });
    await sleep(1200);
    const page = readEditPage(tabIndex, windowIndex);
    const liveName = page?.name || "";
    const ok = normName(liveName) === normName(item.posName);
    return { ...item, liveName, ok };
  });
}

async function renameOne(tabIndex, item, apply, windowIndex) {
  chromeJsOnTab(tabIndex, `(() => { location.href='${editUrl(item.dishId)}'; return 'ok'; })()`, {
    windowIndex,
  });
  await sleep(1600);
  const before = readEditPage(tabIndex, windowIndex);
  if (!before?.onEdit) return { ...item, status: "error", error: "edit page not open" };
  if (normName(before.name) === normName(item.posName)) {
    return { ...item, status: "skip", beforeName: before.name };
  }
  const result = setNameOnTab(tabIndex, item.posName, apply, windowIndex);
  if (result?.error) return { ...item, status: "error", error: result.error, beforeName: before.name };
  if (!apply) return { ...item, status: "dry-run", beforeName: result.before, afterName: result.after };
  await sleep(2800);
  const verify = readEditPage(tabIndex, windowIndex);
  const ok = normName(verify?.name) === normName(item.posName);
  return {
    ...item,
    status: ok ? "renamed" : "verify_fail",
    beforeName: before.name,
    afterName: verify?.name,
  };
}

function updateBaselineCsv(byCode) {
  const rows = parse(readFileSync(BASELINE), { columns: true, skip_empty_lines: true });
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

function updateLiveScan(byId) {
  const scan = JSON.parse(readFileSync(SCAN, "utf8"));
  for (const it of scan.items) {
    if (it.dishId && byId[it.dishId]) it.name = byId[it.dishId];
  }
  scan.verifiedRenameAt = new Date().toISOString();
  writeFileSync(SCAN, JSON.stringify(scan, null, 2) + "\n");
}

async function main() {
  const apply = process.argv.includes("--apply");
  const workersArg = process.argv.find((a) => a.startsWith("--workers="));
  const workers = workersArg ? Math.min(10, Math.max(2, Number(workersArg.slice(10)))) : 6;

  const pairs = loadPairs();
  console.log(`=== Shopee name sync ← POS (${apply ? "APPLY" : "dry-run"}) ===`);
  console.log(`Checking ${pairs.length} menus…`);

  const live = await readLiveNames(pairs, workers);
  const mismatches = live.filter((r) => !r.ok);

  console.log(`Match: ${live.length - mismatches.length}/${live.length}`);
  if (!mismatches.length) {
    console.log("All Shopee names already match POS — nothing to do.");
    return;
  }

  mismatches.forEach((m) => console.log(`  FIX: "${m.liveName}" → "${m.posName}"`));

  if (!apply) {
    console.log("\nRe-run with --apply to rename on Shopee.");
    return;
  }

  console.log(`\nRenaming ${mismatches.length} items…`);
  const log = await mapPool(mismatches, workers, async (tabIndex, item, i, windowIndex) => {
    const r = await renameOne(tabIndex, item, true, windowIndex);
    console.log(`[${i + 1}/${mismatches.length}] ${r.status}: ${r.beforeName || "?"} → ${item.posName}`);
    return { from: r.beforeName || item.liveName, to: item.posName, dishId: item.dishId, ...r };
  });

  writeFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), apply: true, log }, null, 2) + "\n");

  const failed = log.filter((r) => r.status === "error" || r.status === "verify_fail");
  if (failed.length) {
    console.error("Some renames failed:", failed.length);
    process.exit(2);
  }

  const byId = Object.fromEntries(log.map((r) => [r.dishId, r.to]));
  updateBaselineCsv(byId);
  updateLiveScan(byId);

  console.log("\nRe-verify…");
  const verify = await readLiveNames(pairs, workers);
  const stillBad = verify.filter((r) => !r.ok);
  console.log(`Verify: ${verify.length - stillBad.length}/${verify.length} OK`);
  if (stillBad.length) process.exit(2);

  execSync("node scripts/push-shopee-pos-diff-to-sheet.mjs", { stdio: "inherit", cwd: join(__dir, "..") });
  console.log("\nDone — Shopee names synced to POS.");
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
