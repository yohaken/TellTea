#!/usr/bin/env node
/**
 * Verify every Grab item name vs POS (หน้าร้าน) via Chrome multi-tab.
 * Writes grab-name-verify.json and refreshes name-sync sheet check column.
 *
 *   node scripts/grab-chrome-verify-names.mjs --workers=4
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { normName } from "./lib/grab-csv.mjs";
import { isStoreOnlyName, buildGrabRenameToPosPlan } from "./lib/name-sync-match.mjs";
import {
  findGrabTab,
  openEditItem,
  mapPool,
  editUrl,
  chromeJsOnTab,
  readEditPage,
  sleep,
} from "./lib/grab-chrome.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const GRAB_SCAN = join(__dir, "data/menu-price-baseline/grab-live-scan.json");
const POS_MENU = join(__dir, "data/menu-price-baseline/telltea-menu-prices-snapshot-2026-09-01.csv");
const OUT = join(__dir, "data/menu-price-baseline/grab-name-verify.json");

function field(row, key) {
  return row[key] ?? row[`\ufeff${key}`] ?? "";
}

async function readName(tabIndex, item, windowIndex) {
  // Prefer inventory deep-link for reliable name read
  chromeJsOnTab(tabIndex, `(() => { location.href='${editUrl(item.itemId)}'; return 'ok'; })()`, {
    windowIndex,
  });
  for (let i = 0; i < 10; i++) {
    await sleep(600);
    const page = readEditPage(tabIndex, windowIndex);
    if (page?.name) {
      return {
        itemId: item.itemId,
        expectedGrabName: item.name,
        liveName: page.name,
        status: page.status || item.status || "",
        url: page.url,
        availableHint: /UNAVAILABLE|ไม่พร้อม|ของหมด/.test(page.url + (page.name || "")) ? "" : "",
      };
    }
  }
  // fallback menu path
  const page = await openEditItem(tabIndex, item.itemId, item.name, windowIndex, item.category || "");
  return {
    itemId: item.itemId,
    expectedGrabName: item.name,
    liveName: page?.name || "",
    status: "fallback_menu",
    url: page?.url || "",
  };
}

async function main() {
  const workersArg = process.argv.find((a) => a.startsWith("--workers="));
  const workers = workersArg ? Math.min(8, Math.max(1, Number(workersArg.slice(10)))) : 4;
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.slice(8)) : Infinity;

  if (!existsSync(GRAB_SCAN)) throw new Error("Missing grab-live-scan.json");
  const scan = JSON.parse(readFileSync(GRAB_SCAN, "utf8"));
  const posRows = parse(readFileSync(POS_MENU), { columns: true, skip_empty_lines: true, bom: true }).map((r) => ({
    id: field(r, "id"),
    name: field(r, "name"),
    category: field(r, "category"),
    active: field(r, "active") === "true" || field(r, "active") === true,
  }));
  const deliveryPos = posRows.filter((p) => p.active && !isStoreOnlyName(p.name));
  const posByNorm = new Map(deliveryPos.map((p) => [normName(p.name), p]));

  let queue = (scan.items || []).map((it) => ({
    itemId: it.itemId,
    name: it.name,
    category: it.category || "",
    status: it.status || "",
  }));
  if (Number.isFinite(limit)) queue = queue.slice(0, limit);

  console.log(`=== Grab name verify ×${workers} — ${queue.length} items ===`);
  findGrabTab();
  const started = Date.now();

  const live = await mapPool(queue, workers, async (tabIndex, item, i, windowIndex) => {
    const r = await readName(tabIndex, item, windowIndex);
    const pos = posByNorm.get(normName(r.liveName));
    const match = !!pos;
    const storeOnlyPolicy = r.liveName === "น้ำเปล่า" || /น้ำเปล่า/.test(r.liveName);
    const row = {
      ...r,
      posName: pos?.name || "",
      posCategory: pos?.category || "",
      matchPos: match,
      check: storeOnlyPolicy
        ? "เฉพาะหน้าร้าน — ไม่ควรขาย Grab"
        : match
          ? "ตรง"
          : "ไม่ตรง",
    };
    console.log(`[${i + 1}/${queue.length}] ${row.check}: ${(r.liveName || "?").slice(0, 40)}`);
    return row;
  });

  // Update scan names from live
  const byId = new Map((scan.items || []).map((it) => [it.itemId, it]));
  for (const r of live) {
    const it = byId.get(r.itemId);
    if (it && r.liveName) it.name = r.liveName;
  }
  scan.verifiedNamesAt = new Date().toISOString();
  writeFileSync(GRAB_SCAN, JSON.stringify(scan, null, 2) + "\n");

  const renamePlan = buildGrabRenameToPosPlan(scan.items || [], posRows);
  writeFileSync(
    join(__dir, "data/menu-price-baseline/grab-rename-to-pos-plan.json"),
    JSON.stringify(renamePlan, null, 2) + "\n",
  );

  const summary = {
    at: new Date().toISOString(),
    workers,
    total: live.length,
    matchPos: live.filter((r) => r.matchPos).length,
    mismatch: live.filter((r) => r.check === "ไม่ตรง").length,
    storeOnlyOnGrab: live.filter((r) => String(r.check).includes("เฉพาะหน้าร้าน")).length,
    elapsedSec: Math.round((Date.now() - started) / 1000),
    results: live,
  };
  writeFileSync(OUT, JSON.stringify(summary, null, 2) + "\n");

  console.log(
    `\nDone ${summary.elapsedSec}s · ตรง POS ${summary.matchPos}/${summary.total} · ไม่ตรง ${summary.mismatch} · น้ำเปล่าบน Grab ${summary.storeOnlyOnGrab}`,
  );
  console.log(`→ ${OUT}`);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
