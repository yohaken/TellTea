#!/usr/bin/env node
/**
 * LINE MAN (Wongnai) price apply from hub targets (POS หน้าร้าน + สูตร lineman ใน menuPriceHub/settings).
 * Direct target, no 15% step · verify + tracker JSON.
 *
 *   node scripts/lineman-chrome-batch-update.mjs --dry-run
 *   node scripts/lineman-chrome-batch-update.mjs --dry-run --limit=3
 *   node scripts/lineman-chrome-batch-update.mjs --apply --workers=4
 *   node scripts/lineman-chrome-batch-update.mjs --apply --workers=4 --rounds=5 --retry-blocked
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLinemanHubPlan } from "./lib/hub-channel-targets.mjs";
import { writeHubLiveFromApplyResult } from "./lib/hub-live-write.mjs";
import {
  findWongnaiTab,
  openEditItem,
  savePriceAndRead,
  verifyPersistedPrice,
  mapPool,
} from "./lib/lineman-chrome.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const SCAN = join(__dir, "data/menu-price-baseline/lineman-live-scan.json");
const TRACKER = join(__dir, "data/menu-price-baseline/lineman-price-tracker.json");
const LOG = join(__dir, "data/menu-price-baseline/lineman-update-log.json");

function loadTracker() {
  if (!existsSync(TRACKER)) return { round: 0, items: {} };
  try {
    return JSON.parse(readFileSync(TRACKER, "utf8"));
  } catch {
    return { round: 0, items: {} };
  }
}

async function loadPlanHub(tracker = loadTracker(), { retryBlocked = false } = {}) {
  if (!existsSync(SCAN)) throw new Error("Missing lineman-live-scan.json — สแกน LINE MAN ก่อน");
  const scan = JSON.parse(readFileSync(SCAN, "utf8"));
  return buildLinemanHubPlan(scan.items || [], { tracker, retryBlocked });
}

function syncScanFromResults(results) {
  if (!existsSync(SCAN)) return;
  const scan = JSON.parse(readFileSync(SCAN, "utf8"));
  const byId = new Map((scan.items || []).map((it) => [it.id, it]));
  for (const r of results) {
    if (r.after == null || !Number.isFinite(Number(r.after)) || Number(r.after) <= 0) continue;
    const it = byId.get(r.id);
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

async function updateOne(tabIndex, item, apply, windowIndex) {
  const page = await openEditItem(tabIndex, item.id, item.name, windowIndex, item.href);
  if (!page?.onEdit || page.listPrice == null) {
    return { ...item, status: "error", error: "edit page not open" };
  }

  const liveBefore = Number(page.listPrice);
  if (liveBefore === item.target) {
    return { ...item, status: "skip_at_target", before: liveBefore, after: liveBefore, changed: false };
  }

  const applyPrice = item.target;

  if (!apply) {
    return {
      ...item,
      status: "dry-run",
      before: liveBefore,
      attempted: applyPrice,
      after: liveBefore,
      changed: false,
      menuBlocked: !!page.menuBlocked,
    };
  }

  const result = await savePriceAndRead(tabIndex, applyPrice, true, windowIndex);
  if (result?.error) {
    return {
      ...item,
      status: page.menuBlocked ? "blocked_menu_ui" : "error",
      error: result.error,
      before: liveBefore,
      attempted: applyPrice,
      after: liveBefore,
      changed: false,
    };
  }

  const persisted = await verifyPersistedPrice(tabIndex, item.id, windowIndex, item.href);
  const after = Number.isFinite(persisted) ? persisted : Number(result.after);
  const changed = Number.isFinite(after) && after !== liveBefore;
  let status = "updated";
  if (result.blocked && !changed) status = "blocked_popup";
  else if (!changed && page.menuBlocked) status = "blocked_menu_ui";
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
    menuBlocked: !!page.menuBlocked,
    externalId: String(item.id),
  };
}

function mergeTracker(tracker, log, round) {
  for (const r of log) {
    const key = r.id || r.name;
    if (!tracker.items[key]) {
      tracker.items[key] = {
        name: r.name,
        id: r.id,
        targetPrice: r.target,
        rounds: [],
      };
    }
    const entry = tracker.items[key];
    entry.targetPrice = r.target;
    entry.currentLive = r.after ?? r.before ?? entry.currentLive;
    entry.reachedTarget = entry.currentLive === r.target;
    entry.source = r.source || entry.source;
    entry.posId = r.posId || entry.posId;
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

async function runOneRound({ apply, workers, limit, from, retryBlocked, tracker }) {
  const plan = await loadPlanHub(tracker, { retryBlocked });
  const meta = plan.meta || {};
  const allTodo = plan.todo;
  const todo = allTodo.slice(from, from + (Number.isFinite(limit) ? limit : 9999));

  const ruleLabel = `hub · LINE MAN ${formatRule(meta.linemanRule)}`;
  console.log(`=== LINE MAN price ×${workers} ${apply ? "APPLY" : "DRY-RUN"} (target=${ruleLabel}) ===`);
  console.log(
    `Remaining ${allTodo.length}/${meta.matched || "?"} → workers=${workers}${
      retryBlocked ? " · retry-blocked" : ""
    }`,
  );
  console.log(
    `Queue: ${todo.length} · matched ${meta.matched ?? "?"} · at-target ${meta.atTarget ?? 0} · blocked-skip ${meta.blockedSkip ?? 0} · store-only skip ${meta.storeOnlySkip ?? 0}`,
  );

  if (!todo.length) {
    console.log("Nothing to update — already at target / no match / blocked_menu_ui");
    return { log: [], todo: [], empty: true, stats: { updated: 0, blocked: 0 } };
  }

  findWongnaiTab();
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
        JSON.stringify({ at: new Date().toISOString(), round, apply, workers, retryBlocked, log }, null, 2) + "\n",
      );
      if (r.after != null && Number(r.after) > 0) syncScanFromResults([r]);
      const ok = await writeHubLiveFromApplyResult("lineman", { ...r, externalId: String(r.id) });
      if (ok) console.log(`  ↳ hub L ← ${r.after ?? r.before} · ${String(r.name || "").slice(0, 28)}`);
    }
    return r;
  });

  writeFileSync(
    LOG,
    JSON.stringify({ at: new Date().toISOString(), round, apply, workers, retryBlocked, log }, null, 2) + "\n",
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
  return { log, todo, empty: false, stats };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const retryBlocked = process.argv.includes("--retry-blocked");
  const workersArg = process.argv.find((a) => a.startsWith("--workers="));
  const workers = workersArg ? Math.min(8, Math.max(1, Number(workersArg.slice(10)))) : 4;
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const fromArg = process.argv.find((a) => a.startsWith("--from="));
  const roundsArg = process.argv.find((a) => a.startsWith("--rounds="));
  const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : Infinity;
  const from = fromArg ? Number(fromArg.slice("--from=".length)) : 0;
  const maxRounds = roundsArg
    ? Math.max(1, Number(roundsArg.slice("--rounds=".length)) || 1)
    : apply
      ? 20
      : 1;

  const tracker = loadTracker();
  let last = null;
  let stagnant = 0;
  for (let i = 0; i < maxRounds; i++) {
    const useRetry = retryBlocked || i > 0;
    if (i > 0) console.log(`\n—— round ${i + 1}/${maxRounds}${useRetry ? " · retry-blocked" : ""} ——`);
    last = await runOneRound({
      apply,
      workers,
      limit,
      from,
      retryBlocked: useRetry,
      tracker,
    });
    if (last.empty) {
      console.log("คิวว่าง — ครบแล้ว");
      break;
    }
    if (!apply) break;
    const changed = last.stats?.updated || 0;
    if (changed === 0) {
      stagnant += 1;
      if (stagnant >= 2) {
        console.log("ไม่คืบหน้า 2 รอบซ้อน — หยุด");
        break;
      }
      console.log("รอบนี้ไม่เปลี่ยนราคา — ลองรอบถัดไป");
      continue;
    }
    stagnant = 0;
  }

  if (apply && last && !last.empty) {
    console.log(
      "หมายเหตุ: หลัง apply ควรสแกน LINE MAN อีกรอบเพื่อยืนยันราคาจริงใน hub — node scripts/lineman-chrome-scan.mjs --workers=4",
    );
  }
  process.exit(0);
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === join(process.cwd(), process.argv[1].replace(/^\.\//, ""));

if (isMain || process.argv[1]?.endsWith("lineman-chrome-batch-update.mjs")) {
  main().catch((e) => {
    console.error("FAIL:", e.message);
    process.exit(1);
  });
}
