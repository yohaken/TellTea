#!/usr/bin/env node
/**
 * Rename Grab menu names → POS storefront names via real Chrome (multi-tab).
 *
 *   node scripts/grab-chrome-rename-batch.mjs --dry-run --workers=4
 *   node scripts/grab-chrome-rename-batch.mjs --apply --workers=4
 *   node scripts/grab-chrome-rename-batch.mjs --apply --workers=4 --limit=3
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { normName } from "./lib/grab-csv.mjs";
import { buildGrabRenameToPosPlan, isStoreOnlyName } from "./lib/name-sync-match.mjs";
import {
  findGrabTab,
  openEditItem,
  saveNameAndRead,
  readEditPage,
  mapPool,
} from "./lib/grab-chrome.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const PLAN = join(__dir, "data/menu-price-baseline/grab-rename-to-pos-plan.json");
const GRAB_SCAN = join(__dir, "data/menu-price-baseline/grab-live-scan.json");
const POS_MENU = join(__dir, "data/menu-price-baseline/telltea-menu-prices-snapshot-2026-09-01.csv");
const LOG = join(__dir, "data/menu-price-baseline/grab-rename-log.json");

function field(row, key) {
  return row[key] ?? row[`\ufeff${key}`] ?? "";
}

function loadTodo() {
  if (existsSync(PLAN)) {
    const plan = JSON.parse(readFileSync(PLAN, "utf8"));
    return (plan.rename || []).map((r) => ({
      from: r.grabName,
      to: r.posName,
      itemId: r.grabId,
      category: r.grabCategory || "",
      reason: r.reason || "",
    }));
  }
  const scan = JSON.parse(readFileSync(GRAB_SCAN, "utf8"));
  const pos = parse(readFileSync(POS_MENU), { columns: true, skip_empty_lines: true, bom: true }).map((r) => ({
    id: field(r, "id"),
    name: field(r, "name"),
    category: field(r, "category"),
    active: field(r, "active") === "true" || field(r, "active") === true,
  }));
  const plan = buildGrabRenameToPosPlan(scan.items || [], pos);
  writeFileSync(PLAN, JSON.stringify(plan, null, 2) + "\n");
  return plan.rename.map((r) => ({
    from: r.grabName,
    to: r.posName,
    itemId: r.grabId,
    category: r.grabCategory || "",
    reason: r.reason || "",
  }));
}

async function renameOne(tabIndex, item, apply, windowIndex) {
  // Open by current Grab name; after rename verify with POS name
  const page = await openEditItem(tabIndex, item.itemId, item.from, windowIndex, item.category);
  if (!page?.onEdit) {
    return { ...item, status: "error", error: "edit page not open", beforeName: page?.name };
  }
  if (page.inventoryOnly || page.inventoryBlocked || page.nameEditable === false) {
    if (normName(page.name) === normName(item.to)) {
      return { ...item, status: "skip_already", beforeName: page.name, afterName: page.name };
    }
    return {
      ...item,
      status: "blocked_menu_ui",
      error: "name field locked / not on Grab menu UI",
      beforeName: page.name,
    };
  }

  const beforeName = page.name || item.from;
  if (normName(beforeName) === normName(item.to)) {
    return { ...item, status: "skip_already", beforeName, afterName: beforeName };
  }

  const result = await saveNameAndRead(tabIndex, item.to, apply, windowIndex);
  if (result?.locked || result?.error) {
    return {
      ...item,
      status: result.locked ? "blocked_menu_ui" : "error",
      error: result.error,
      beforeName: result.before || beforeName,
    };
  }
  if (!apply) {
    return { ...item, status: "dry-run", beforeName: result.before, afterName: result.after };
  }

  // Re-open with NEW name for verify (search by POS name)
  const verify = await openEditItem(tabIndex, item.itemId, item.to, windowIndex, item.category);
  const afterName = verify?.name || result.afterName || result.after;
  const ok = normName(afterName) === normName(item.to);
  return {
    ...item,
    status: ok ? "renamed" : "verify_fail",
    beforeName,
    afterName,
    url: verify?.url || result.url,
  };
}

function patchScanNames(log) {
  if (!existsSync(GRAB_SCAN)) return 0;
  const scan = JSON.parse(readFileSync(GRAB_SCAN, "utf8"));
  const byId = new Map((scan.items || []).map((it) => [it.itemId, it]));
  let n = 0;
  for (const r of log) {
    if (r.status !== "renamed" && r.status !== "skip_already") continue;
    const it = byId.get(r.itemId);
    if (!it) continue;
    const next = r.afterName || r.to;
    if (it.name !== next) {
      it.name = next;
      n++;
    }
  }
  scan.renamedAt = new Date().toISOString();
  writeFileSync(GRAB_SCAN, JSON.stringify(scan, null, 2) + "\n");
  return n;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const workersArg = process.argv.find((a) => a.startsWith("--workers="));
  const workers = workersArg ? Math.min(8, Math.max(1, Number(workersArg.slice(10)))) : 4;
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.slice(8)) : Infinity;

  let todo = loadTodo().filter((t) => !isStoreOnlyName(t.to) && t.from !== "น้ำเปล่า");
  todo = todo.slice(0, Number.isFinite(limit) ? limit : todo.length);

  console.log(`=== Grab rename ×${workers} ${apply ? "APPLY" : "DRY-RUN"} (เป้า = ชื่อ POS หน้าร้าน) ===`);
  console.log(`Queue: ${todo.length}`);
  if (!todo.length) {
    console.log("Nothing to rename");
    return;
  }

  findGrabTab();
  const started = Date.now();
  const log = [];

  await mapPool(todo, workers, async (tabIndex, item, i, windowIndex) => {
    const r = { ...(await renameOne(tabIndex, item, apply, windowIndex)), at: new Date().toISOString() };
    log[i] = r;
    console.log(
      `[${i + 1}/${todo.length}] ${r.status}: "${(r.beforeName || item.from).slice(0, 32)}" → "${item.to.slice(0, 32)}"`,
    );
    if (apply) {
      writeFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), apply, workers, log }, null, 2) + "\n");
    }
    return r;
  });

  writeFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), apply, workers, log }, null, 2) + "\n");
  if (apply) patchScanNames(log);

  const stats = {
    renamed: log.filter((r) => r.status === "renamed").length,
    skip: log.filter((r) => r.status === "skip_already" || r.status === "dry-run").length,
    blocked: log.filter((r) => r.status === "blocked_menu_ui").length,
    fail: log.filter((r) => r.status === "error" || r.status === "verify_fail").length,
  };
  console.log(
    `\nDone in ${Math.round((Date.now() - started) / 1000)}s · renamed ${stats.renamed} · skip/dry ${stats.skip} · blocked ${stats.blocked} · fail ${stats.fail}`,
  );
  console.log(`→ ${LOG}`);
  if (stats.fail || stats.blocked) process.exitCode = 2;
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
