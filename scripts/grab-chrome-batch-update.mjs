#!/usr/bin/env node
/**
 * Grab price apply from hub targets (POS หน้าร้าน + สูตร Grab ใน menuPriceHub/settings).
 * Direct target, no 15% step · verify + tracker JSON.
 *
 * Auto workers: 4 tabs when remaining > 30% of matched items; otherwise 1 tab.
 *
 *   node scripts/grab-chrome-batch-update.mjs --dry-run
 *   node scripts/grab-chrome-batch-update.mjs --apply --limit=5
 *   node scripts/grab-chrome-batch-update.mjs --apply --note="update price"
 *   node scripts/grab-chrome-batch-update.mjs --apply --workers=4
 *   node scripts/grab-chrome-batch-update.mjs --dry-run --source=shopee-baseline
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadShopeeTargetsForGrab, matchGrabTarget } from "./lib/grab-targets.mjs";
import { buildGrabHubPlan } from "./lib/hub-channel-targets.mjs";
import { writeHubLiveFromApplyResult } from "./lib/hub-live-write.mjs";
import {
  findGrabTab,
  openEditItem,
  savePriceAndRead,
  verifyPersistedPrice,
  mapPool,
  clearGrabDownloads,
} from "./lib/grab-chrome.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const SCAN = join(__dir, "data/menu-price-baseline/grab-live-scan.json");
const TRACKER = join(__dir, "data/menu-price-baseline/grab-price-tracker.json");
const LOG = join(__dir, "data/menu-price-baseline/grab-update-log.json");

function loadTracker() {
  if (!existsSync(TRACKER)) return { round: 0, items: {} };
  try {
    return JSON.parse(readFileSync(TRACKER, "utf8"));
  } catch {
    return { round: 0, items: {} };
  }
}

function bestKnownLive(it, tracker) {
  const entry = tracker.items?.[it.itemId] || tracker.items?.[it.name];
  const fromTracker = entry?.currentLive;
  if (fromTracker != null && Number.isFinite(Number(fromTracker))) return Number(fromTracker);
  return Number(it.listPrice);
}

function loadPlanShopeeBaseline(tracker = loadTracker()) {
  if (!existsSync(SCAN)) throw new Error("Missing grab-live-scan.json");
  const scan = JSON.parse(readFileSync(SCAN, "utf8"));
  const targets = loadShopeeTargetsForGrab();
  const todo = [];
  for (const it of scan.items || []) {
    if (it.listPrice == null && bestKnownLive(it, tracker) == null) continue;
    const s = matchGrabTarget(it.name, targets);
    if (!s) continue;
    const target = Number(s.target);
    const current = bestKnownLive(it, tracker);
    if (!Number.isFinite(current) || current === target) continue;
    const entry = tracker.items?.[it.itemId] || tracker.items?.[it.name];
    const last = entry?.rounds?.[entry.rounds.length - 1];
    if (last?.status === "blocked_menu_ui") continue;
    todo.push({
      name: it.name,
      itemId: it.itemId,
      category: it.category || "",
      current,
      target,
      applyPrice: target,
      diff: current - target,
      shopeeName: s.shopeeName,
      source: "shopee-baseline",
    });
  }
  todo.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  return { todo, meta: { source: "shopee-baseline" } };
}

async function loadPlanHub(tracker = loadTracker(), { retryBlocked = false, noteFilter = "" } = {}) {
  if (!existsSync(SCAN)) throw new Error("Missing grab-live-scan.json — สแกน Grab ก่อน");
  const scan = JSON.parse(readFileSync(SCAN, "utf8"));
  return buildGrabHubPlan(scan.items || [], {
    tracker,
    retryBlocked,
    noteFilter,
    includeAtTarget: !!noteFilter,
  });
}

function syncScanFromResults(results) {
  if (!existsSync(SCAN)) return;
  const scan = JSON.parse(readFileSync(SCAN, "utf8"));
  const byId = new Map((scan.items || []).map((it) => [it.itemId, it]));
  for (const r of results) {
    if (r.after == null || !Number.isFinite(Number(r.after))) continue;
    const it = byId.get(r.itemId);
    if (!it) continue;
    if (Number(it.listPrice) !== Number(r.after)) {
      it.listPrice = Number(r.after);
    }
  }
  const now = new Date().toISOString();
  scan.syncedFromApplyAt = now;
  scan.scannedAt = now;
  writeFileSync(SCAN, JSON.stringify(scan, null, 2) + "\n");
}

function formatRule(rule) {
  if (!rule) return "";
  if (rule.mode === "gp") return `GP ${rule.value}%`;
  if (rule.mode === "percent") return `${rule.value}%`;
  if (rule.mode === "absolute") return `฿${rule.value}`;
  return `มาร์จ ${rule.value}`;
}

const MULTI_WORKERS = 4;
const MULTI_REMAINING_RATIO = 0.3;

function pickWorkers(explicit, remainingRatio) {
  if (explicit != null && Number.isFinite(explicit)) {
    return Math.min(8, Math.max(1, explicit));
  }
  return remainingRatio > MULTI_REMAINING_RATIO ? MULTI_WORKERS : 1;
}

async function updateOne(tabIndex, item, apply, windowIndex) {
  const page = await openEditItem(tabIndex, item.itemId, item.name, windowIndex, item.category);
  if (!page?.onEdit || page.listPrice == null) {
    return { ...item, status: "error", error: "edit page not open" };
  }

  const liveBefore = Number(page.listPrice);
  if (liveBefore === item.target) {
    return { ...item, status: "skip_at_target", before: liveBefore, after: liveBefore, changed: false };
  }

  const applyPrice = item.target;
  const onMenuEditor =
    /\/food\/menu\//.test(page.url || "") &&
    !/\/inventory\//.test(page.url || "") &&
    !page.inventoryOnly;

  if (!apply) {
    return {
      ...item,
      status: "dry-run",
      before: liveBefore,
      attempted: applyPrice,
      after: liveBefore,
      changed: false,
      inventoryOnly: !!page.inventoryOnly,
      url: page.url || "",
    };
  }

  if (!onMenuEditor) {
    return {
      ...item,
      status: "blocked_menu_ui",
      error: "not on menu overview editor",
      before: liveBefore,
      attempted: applyPrice,
      after: liveBefore,
      changed: false,
      inventoryOnly: true,
      url: page.url || "",
    };
  }

  const result = await savePriceAndRead(tabIndex, applyPrice, true, windowIndex);
  if (result?.error) {
    return {
      ...item,
      status: page.inventoryOnly ? "blocked_menu_ui" : "error",
      error: result.error,
      before: liveBefore,
      attempted: applyPrice,
      after: liveBefore,
      changed: false,
    };
  }

  const persisted = await verifyPersistedPrice(
    tabIndex,
    item.itemId,
    item.name,
    windowIndex,
    item.category,
  );
  const after = Number.isFinite(persisted) ? persisted : Number(result.after);
  const changed = Number.isFinite(after) && after !== liveBefore;
  let status = "updated";
  if (result.blocked && !changed) status = "blocked_popup";
  else if (!changed && page.inventoryOnly) status = "blocked_menu_ui";
  else if (!changed) status = "no_change";
  else if (after === item.target) status = "reached_target";
  else if (after !== applyPrice) status = "partial";

  return {
    ...item,
    status,
    before: liveBefore,
    attempted: applyPrice,
    after,
    changed,
    popupText: result.popupText || "",
    blocked: !!result.blocked,
    inventoryOnly: !!page.inventoryOnly,
  };
}

function mergeTracker(tracker, log, round) {
  for (const r of log) {
    const key = r.itemId || r.name;
    if (!tracker.items[key]) {
      tracker.items[key] = {
        name: r.name,
        itemId: r.itemId,
        targetPrice: r.target,
        rounds: [],
      };
    }
    const entry = tracker.items[key];
    entry.targetPrice = r.target;
    entry.currentLive = r.after ?? r.before ?? entry.currentLive;
    entry.reachedTarget = entry.currentLive === r.target;
    entry.source = r.source || entry.source;
    entry.rounds.push({
      round,
      at: r.at,
      before: r.before,
      attempted: r.attempted,
      after: r.after,
      changed: r.changed,
      status: r.status,
      popupText: r.popupText || "",
    });
  }
  tracker.round = round;
  tracker.updatedAt = new Date().toISOString();
  return tracker;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const retryBlocked = process.argv.includes("--retry-blocked");
  const sourceArg = process.argv.find((a) => a.startsWith("--source="));
  const source = sourceArg ? sourceArg.slice(9) : "hub";
  const workersArg = process.argv.find((a) => a.startsWith("--workers="));
  const explicitWorkers = workersArg ? Number(workersArg.slice(10)) : null;
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const fromArg = process.argv.find((a) => a.startsWith("--from="));
  const noteArg = process.argv.find((a) => a.startsWith("--note="));
  const noteFilter = noteArg ? noteArg.slice(7) : "";
  const nameArg = process.argv.find((a) => a.startsWith("--name="));
  const nameFilter = nameArg ? nameArg.slice(7).trim().toLowerCase() : "";
  const catArg = process.argv.find((a) => a.startsWith("--category="));
  const catFilter = catArg ? catArg.slice(11).trim().toLowerCase() : "";
  const limit = limitArg ? Number(limitArg.slice(8)) : Infinity;
  const from = fromArg ? Number(fromArg.slice(6)) : 0;

  const tracker = loadTracker();
  const plan =
    source === "shopee-baseline"
      ? loadPlanShopeeBaseline(tracker)
      : await loadPlanHub(tracker, { retryBlocked, noteFilter });
  const allTodo = plan.todo;
  const meta = plan.meta || {};
  const remaining = allTodo.length;
  const matched = meta.matched ?? remaining;
  const ratio = matched ? remaining / matched : 0;
  // default 1 worker เมื่อไล่เฉพาะที่ยังไม่ซิงค์
  const workers = pickWorkers(explicitWorkers ?? 1, ratio);
  let todo = allTodo;
  if (nameFilter) {
    todo = todo.filter((row) => String(row.name || "").toLowerCase().includes(nameFilter));
  }
  if (catFilter) {
    todo = todo.filter((row) => String(row.category || "").toLowerCase().includes(catFilter));
  }
  if (noteFilter) {
    todo = [...todo].sort((a, b) => {
      const ba = /เบเกอรี่/.test(a.category || "") ? 0 : 1;
      const bb = /เบเกอรี่/.test(b.category || "") ? 0 : 1;
      if (ba !== bb) return ba - bb;
      return String(a.name).localeCompare(String(b.name), "th");
    });
  }
  todo = todo.slice(from, from + (Number.isFinite(limit) ? limit : 9999));

  const ruleLabel =
    source === "hub" ? `hub · Grab ${formatRule(meta.grabRule)}` : "Shopee baseline";
  console.log(`=== Grab price ×${workers} ${apply ? "APPLY" : "DRY-RUN"} (target=${ruleLabel}) ===`);
  console.log(
    `Remaining ${remaining}/${matched || "?"} (${(ratio * 100).toFixed(0)}%) → workers=${workers}${
      retryBlocked ? " · retry-blocked" : ""
    }`,
  );
  if (source === "hub") {
    console.log(
      `Queue: ${todo.length} · matched ${meta.matched ?? "?"} · at-target ${meta.atTarget ?? 0} · blocked-skip ${meta.blockedSkip ?? 0} · store-only skip ${meta.storeOnlySkip ?? 0}${
        noteFilter ? ` · note «${noteFilter}» skip ${meta.noteSkip ?? 0}` : ""
      }`,
    );
    for (const row of todo) {
      console.log(
        `  ${row.current}→${row.target}  ${row.name}  · หน้าร้าน ${row.storePrice} · ${formatRule(row.rule)}${
          row.hubNote ? ` · ${row.hubNote}` : ""
        }`,
      );
    }
  } else {
    console.log(`Queue: ${todo.length} (ยกราคา Shopee มาใส่ Grab)`);
  }

  const staleZip = join(__dir, "data/menu-price-baseline/grab-hub-price-update.zip");
  const staleCsv = join(__dir, "data/menu-price-baseline/grab-hub-price-menu.csv");
  const staleErr = join(__dir, "data/menu-price-baseline/grab-hub-price-error-report.csv");
  for (const p of [staleZip, staleCsv, staleErr]) {
    if (existsSync(p)) {
      unlinkSync(p);
      console.log("removed stale upload file:", p);
    }
  }
  const cleared = clearGrabDownloads();
  if (cleared.length) console.log(`cleared Downloads Grab files (${cleared.length}):`, cleared.slice(0, 12).join(", "));

  if (!todo.length) {
    console.log("Nothing to update — already at target / no match / blocked_menu_ui");
    process.exit(0);
  }

  findGrabTab();
  const started = Date.now();
  const round = (tracker.round || 0) + (apply ? 1 : 0);
  const log = [];

  await mapPool(todo, workers, async (tabIndex, item, i, windowIndex) => {
    const r = { ...(await updateOne(tabIndex, item, apply, windowIndex)), at: new Date().toISOString() };
    log[i] = r;
    const storeBit = item.storePrice != null ? ` · หน้าร้าน ${item.storePrice}` : "";
    const ruleBit = item.rule ? ` · ${formatRule(item.rule)}` : "";
    console.log(
      `[${i + 1}/${todo.length}] ${r.status}: ${item.name.slice(0, 36)} ${r.before ?? item.current}→${r.attempted ?? item.applyPrice} (เป้า ${item.target}${storeBit}${ruleBit})`,
    );
    if (apply) {
      mergeTracker(tracker, [r], round);
      writeFileSync(TRACKER, JSON.stringify(tracker, null, 2) + "\n");
      writeFileSync(
        LOG,
        JSON.stringify({ at: new Date().toISOString(), round, apply, workers, source, retryBlocked, log }, null, 2) +
          "\n",
      );
      if (r.after != null && Number(r.after) > 0) syncScanFromResults([r]);
      if (r.status !== "blocked_menu_ui" && r.status !== "error") {
        const ok = await writeHubLiveFromApplyResult("grab", r);
        if (ok) console.log(`  ↳ hub G ← ${r.after ?? r.before} · ${String(r.name || "").slice(0, 28)}`);
      }
    }
    return r;
  });

  writeFileSync(
    LOG,
    JSON.stringify({ at: new Date().toISOString(), round, apply, workers, source, retryBlocked, log }, null, 2) +
      "\n",
  );
  if (apply) {
    writeFileSync(TRACKER, JSON.stringify(tracker, null, 2) + "\n");
    syncScanFromResults(log.filter((r) => r && Number(r.after) > 0));
  }

  const stats = {
    updated: log.filter((r) => r.changed).length,
    reached: log.filter((r) => r.status === "reached_target" || r.status === "skip_at_target").length,
    blocked: log.filter((r) => r.status === "blocked_popup" || r.status === "blocked_menu_ui").length,
    noChange: log.filter((r) => r.status === "no_change").length,
    errors: log.filter((r) => r.status === "error").length,
  };
  console.log(
    `\nDone in ${Math.round((Date.now() - started) / 1000)}s · changed ${stats.updated} · ถึงเป้า ${stats.reached} · blocked ${stats.blocked} · error ${stats.errors} · no_change ${stats.noChange}`,
  );
  console.log(`→ ${LOG}`);
  if (apply) console.log(`→ ${TRACKER}`);
  if (apply) {
    console.log(
      "หมายเหตุ: หลัง apply ควรสแกน Grab อีกรอบเพื่อยืนยันราคาจริงใน hub — node scripts/grab-chrome-scan.mjs --workers=2",
    );
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
