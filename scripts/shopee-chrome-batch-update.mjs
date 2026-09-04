#!/usr/bin/env node
/**
 * Shopee price apply with 15% step + verify persisted + tracker/hub ทีละแถวทันที.
 * Default target = hub (POS หน้าร้าน + สูตร Shopee ใน menuPriceHub/settings).
 *
 *   node scripts/shopee-chrome-batch-update.mjs --dry-run
 *   node scripts/shopee-chrome-batch-update.mjs --apply --limit=8          # multi-tab (default ×4)
 *   node scripts/shopee-chrome-batch-update.mjs --apply --workers=6
 *   node scripts/shopee-chrome-batch-update.mjs --apply --pipeline         # ทีละแท็บ
 *   node scripts/shopee-chrome-batch-update.mjs --apply --category="Signature Drinks"
 *   node scripts/shopee-chrome-batch-update.mjs --apply --force-cooldown --category="Signature"
 *   node scripts/shopee-chrome-batch-update.mjs --apply --retry-popup     # ลองใหม่รายการติดป๊อปอัปทับข้อมูล
 *
 * Apply default = parallel multi-tab: แต่ละรายการ verify แล้วเขียน hub/hubNote/scannedAt
 * ทันที (ไม่รอจบคิว) · ข้าม 24h cooldown · คิวเรียง scannedAt เก่าสุดก่อน
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { nextStepPrice, diffPct, MAX_STEP_PCT } from "./lib/shopee-price-step.mjs";
import { buildShopeeHubPlan } from "./lib/hub-channel-targets.mjs";
import { writeHubLiveFromApplyResult, writeMenuItemHubNote, loadHubChannelLiveItems, ensureShopeePipelineTableNote } from "./lib/hub-live-write.mjs";
import {
  findShopeeTab,
  readEditPage,
  savePriceAndRead,
  verifyPersistedPrice,
  chromeJsOnTab,
  editUrl,
  sleep,
  mapPool,
} from "./lib/shopee-chrome.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const SCAN = join(__dir, "data/menu-price-baseline/shopee-live-scan.json");
const BASELINE = join(__dir, "data/menu-price-baseline/shopee-baseline-2026-07-15.csv");
const TRACKER = join(__dir, "data/menu-price-baseline/shopee-price-tracker.json");
const LOG = join(__dir, "data/menu-price-baseline/shopee-update-log.json");
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Serialize tracker/hub writes across parallel workers */
let persistChain = Promise.resolve();

function loadTracker() {
  if (!existsSync(TRACKER)) return { round: 0, items: {} };
  try {
    return JSON.parse(readFileSync(TRACKER, "utf8"));
  } catch {
    return { round: 0, items: {} };
  }
}

function formatRule(rule) {
  if (!rule) return "";
  if (rule.mode === "gp") return `GP ${rule.value}%`;
  if (rule.mode === "percent") return `${rule.value}%`;
  if (rule.mode === "absolute") return `฿${rule.value}`;
  return `มาร์จ ${rule.value}`;
}

function loadPlanBaseline(tracker = loadTracker()) {
  const baseline = parse(readFileSync(BASELINE), { columns: true, skip_empty_lines: true });
  const byName = new Map(
    baseline.map((r) => [r.shopeeName, { target: Number(r.shopeePrice), code: r.shopeeCode }]),
  );
  const scan = existsSync(SCAN) ? JSON.parse(readFileSync(SCAN, "utf8")) : { items: [] };
  const todo = [];
  for (const it of scan.items || []) {
    const b = byName.get(it.name);
    if (!b) continue;
    const entry = tracker.items?.[it.dishId] || tracker.items?.[it.name];
    const current =
      entry?.currentLive != null && Number.isFinite(Number(entry.currentLive))
        ? Number(entry.currentLive)
        : Number(it.listPrice);
    if (!Number.isFinite(current)) continue;
    const target = b.target;
    if (current === target) continue;
    const step = nextStepPrice(current, target);
    todo.push({
      name: it.name,
      dishId: it.dishId || b.code,
      current,
      target,
      applyPrice: step.apply,
      reachedInOne: step.reached,
      stepsRemaining: step.stepsRemaining,
      diffPct: diffPct(current, target),
      source: "baseline",
    });
  }
  todo.sort((a, b) => (b.diffPct || 0) - (a.diffPct || 0));
  return { todo, meta: { source: "baseline" } };
}

async function loadPlanHub(tracker = loadTracker()) {
  if (!existsSync(SCAN)) throw new Error("Missing shopee-live-scan.json — สแกน Shopee ก่อน");
  const scan = JSON.parse(readFileSync(SCAN, "utf8"));
  const plan = await buildShopeeHubPlan(scan.items || [], { tracker });
  for (const row of plan.todo) {
    const step = nextStepPrice(row.current, row.target);
    row.applyPrice = step.apply;
    row.reachedInOne = step.reached;
    row.stepsRemaining = step.stepsRemaining;
    row.diffPct = diffPct(row.current, row.target);
  }
  return plan;
}

function syncScanFromResults(results) {
  if (!existsSync(SCAN)) return;
  const scan = JSON.parse(readFileSync(SCAN, "utf8"));
  const byId = new Map((scan.items || []).map((it) => [String(it.dishId), it]));
  for (const r of results) {
    if (!r.verified || r.after == null || !Number.isFinite(Number(r.after)) || Number(r.after) <= 0) continue;
    const it = byId.get(String(r.dishId));
    if (!it) continue;
    it.listPrice = Number(r.after);
  }
  const now = new Date().toISOString();
  scan.syncedFromApplyAt = now;
  scan.scannedAt = now;
  writeFileSync(SCAN, JSON.stringify(scan, null, 2) + "\n");
}

function isShopee24hBlocked(entry) {
  if (!entry) return false;
  if (entry.cooldownUntil && Date.now() < Date.parse(entry.cooldownUntil)) return true;
  const last = entry.rounds?.at(-1);
  if (!last) return false;
  if (!/24 ชั่วโมง/.test(last.popupText || "")) return false;
  const at = Date.parse(last.at || "");
  return Number.isFinite(at) && Date.now() - at < COOLDOWN_MS;
}

/** Concurrent-edit popup — not Shopee's 24h price lock. */
function isRetryablePopup(entry) {
  const last = entry?.rounds?.at(-1);
  if (!last || last.changed) return false;
  if (/24 ชั่วโมง/.test(last.popupText || "")) return false;
  return last.status === "blocked_popup";
}

/** Drop items in 24h cooldown; sort oldest hub scannedAt / never-updated first. */
function filterTodo(todo, tracker, { skipCooldown = true, retryPopup = false, channelLiveItems = {} } = {}) {
  const eligible = [];
  let skippedCooldown = 0;
  for (const item of todo) {
    const entry = tracker.items?.[item.dishId] || tracker.items?.[item.name];
    if (skipCooldown && isShopee24hBlocked(entry) && !(retryPopup && isRetryablePopup(entry))) {
      skippedCooldown++;
      continue;
    }
    eligible.push(item);
  }

  const hubScannedMs = (item) => {
    const obs = channelLiveItems?.[item.posId]?.shopee;
    const t = obs?.scannedAt ? Date.parse(obs.scannedAt) : 0;
    return Number.isFinite(t) ? t : 0;
  };

  eligible.sort((a, b) => {
    const sa = hubScannedMs(a);
    const sb = hubScannedMs(b);
    if (sa !== sb) return sa - sb;

    const pri = (id, name) => {
      const entry = tracker.items?.[id] || tracker.items?.[name];
      if (!entry?.rounds?.length) return 0;
      const last = entry.rounds.at(-1);
      if (last?.changed) return 2;
      return 1;
    };
    return pri(a.dishId, a.name) - pri(b.dishId, b.name);
  });
  return { todo: eligible, skippedCooldown };
}

function fmtShortTs(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Compact note for menuItems.hubNote — AI/user reads on next run. */
function formatShopeeHubNote(r, entry) {
  const live =
    Number.isFinite(Number(r.verifyRead)) ? Number(r.verifyRead)
    : Number.isFinite(Number(r.after)) ? Number(r.after)
    : Number.isFinite(Number(r.before)) ? Number(r.before)
    : null;
  const target = r.target;
  const ts = fmtShortTs(r.at || new Date().toISOString());
  if (live == null) return `S ? ${ts}`;

  if (live === target) return `S:${live} ✓ ${ts}`;

  if (r.verified && r.changed) {
    return `S:${live}→${target} ✓step ${ts}`;
  }

  const inCooldown =
    r.blocked24h ||
    r.status === "blocked_24h" ||
    (entry?.cooldownUntil && Date.now() < Date.parse(entry.cooldownUntil));
  if (inCooldown) {
    const cd = fmtShortTs(entry?.cooldownUntil);
    return `S:${live}→${target} ⏳24h~${cd || ts}`;
  }
  if (r.status === "verify_fail") return `S:${live}→${target} ?verify ${ts}`;
  if (r.status === "blocked_promo") return `S:${live}→${target} ⏳promo ${ts}`;
  if (r.status === "blocked_popup") return `S:${live}→${target} ⏳popup ${ts}`;
  return `S:${live}→${target} ${ts}`;
}

function resolveLivePrice(row) {
  if (Number.isFinite(Number(row.verifyRead))) return Number(row.verifyRead);
  if (row.verified && row.changed && Number.isFinite(Number(row.after))) return Number(row.after);
  if (Number.isFinite(Number(row.before))) return Number(row.before);
  return null;
}

function syncScanOne(row) {
  if (!row.verified || row.after == null || !Number.isFinite(Number(row.after))) return;
  if (!existsSync(SCAN)) return;
  const scan = JSON.parse(readFileSync(SCAN, "utf8"));
  const it = (scan.items || []).find((x) => String(x.dishId) === String(row.dishId));
  if (!it) return;
  it.listPrice = Number(row.after);
  const now = new Date().toISOString();
  scan.syncedFromApplyAt = now;
  scan.scannedAt = now;
  writeFileSync(SCAN, JSON.stringify(scan, null, 2) + "\n");
}

async function updateOne(tabIndex, item, apply, windowIndex) {
  chromeJsOnTab(tabIndex, `(() => { location.href='${editUrl(item.dishId)}'; return 'ok'; })()`, {
    windowIndex,
  });
  await sleep(1500);
  const page = readEditPage(tabIndex, windowIndex);
  if (!page?.onEdit) return { ...item, status: "error", error: "edit page not open" };

  const liveBefore = Number(page.listPrice);
  if (liveBefore === item.target) {
    return { ...item, status: "skip_at_target", before: liveBefore, after: liveBefore, changed: false };
  }

  const step = nextStepPrice(liveBefore, item.target);
  const applyPrice = step.apply;

  if (!apply) {
    return {
      ...item,
      status: "dry-run",
      before: liveBefore,
      attempted: applyPrice,
      after: liveBefore,
      changed: false,
      stepPct: step.stepPct,
    };
  }

  let result = await savePriceAndRead(tabIndex, applyPrice, true, windowIndex);
  if (result?.error) {
    return { ...item, status: "error", error: result.error, before: liveBefore, attempted: applyPrice };
  }
  for (let retry = 0; retry < 2 && /ล่าช้า/.test(result.popupText || "") && apply; retry++) {
    await sleep(6000);
    result = await savePriceAndRead(tabIndex, applyPrice, true, windowIndex);
  }

  const persisted = await verifyPersistedPrice(tabIndex, item.dishId, windowIndex);
  const afterRaw = Number.isFinite(persisted) ? persisted : Number(result.after);
  const after = Number.isFinite(afterRaw) ? afterRaw : liveBefore;
  const changed = after !== liveBefore;
  const verified = Number.isFinite(persisted) && persisted === after;
  const promoBlocked = /โปรโมชัน|promotion price/i.test(result.popupText || "");
  const blocked24h = /24 ชั่วโมง/.test(result.popupText || "");
  let status = "updated";
  if (promoBlocked && !changed) status = "blocked_promo";
  else if (blocked24h && !changed) status = "blocked_24h";
  else if (result.blocked && !changed) status = "blocked_popup";
  else if (!changed) status = verified ? "no_change" : "verify_fail";
  else if (after === item.target) status = "reached_target";
  else if (after !== applyPrice) status = "partial";

  return {
    ...item,
    status,
    before: liveBefore,
    attempted: applyPrice,
    after,
    changed,
    verified: changed && verified,
    verifyRead: persisted,
    stepPct: step.stepPct,
    popupText: result.popupText || "",
    blocked: !!result.blocked,
    blocked24h,
  };
}

function mergeTracker(tracker, log, round) {
  for (const r of log) {
    mergeTrackerRow(tracker, r, round);
  }
  tracker.round = round;
  tracker.updatedAt = new Date().toISOString();
  return tracker;
}

function mergeTrackerRow(tracker, r, round) {
  const key = r.dishId || r.name;
  if (!tracker.items[key]) {
    tracker.items[key] = {
      name: r.name,
      dishId: r.dishId,
      targetPrice: r.target,
      rounds: [],
    };
  }
  const entry = tracker.items[key];
  entry.name = r.name || entry.name;
  entry.dishId = r.dishId || entry.dishId;
  entry.targetPrice = r.target;
  entry.posId = r.posId || entry.posId;
  if (r.verified && r.changed) {
    entry.currentLive = r.after;
    entry.cooldownUntil = new Date(Date.now() + COOLDOWN_MS).toISOString();
  } else if (r.before != null) {
    entry.currentLive = r.before;
  }
  entry.reachedTarget = entry.currentLive === r.target;
  if (r.blocked24h || r.status === "blocked_24h" || ((r.status === "blocked_popup" || r.status === "blocked_promo") && !r.changed)) {
    entry.cooldownUntil = new Date(Date.now() + COOLDOWN_MS).toISOString();
  }
  entry.rounds.push({
    round,
    at: r.at,
    before: r.before,
    attempted: r.attempted,
    after: r.after,
    changed: r.changed,
    verified: !!r.verified,
    verifyRead: r.verifyRead ?? null,
    status: r.status,
    popupText: r.popupText || "",
    source: r.source || "hub",
  });
}

async function persistRow(tracker, row, round) {
  const job = persistChain.then(async () => {
    mergeTrackerRow(tracker, row, round);
    tracker.round = round;
    tracker.updatedAt = new Date().toISOString();

    const key = row.dishId || row.name;
    const entry = tracker.items?.[key];
    const livePrice = resolveLivePrice(row);
    const hubNote = formatShopeeHubNote(row, entry);

    // hub ก่อน — ตารางเห็นทันที ไม่รอจบคิว / ไม่รอเขียนไฟล์ tracker
    if (livePrice != null && row.posId) {
      if (row.verified && row.changed) syncScanOne(row);
      const ok = await writeHubLiveFromApplyResult("shopee", {
        ...row,
        applyNote: hubNote,
        hubNote,
        cooldownUntil: entry?.cooldownUntil || null,
      });
      if (ok) {
        if (!process.argv.includes("--keep-notes")) {
          await writeMenuItemHubNote(row.posId, hubNote);
        }
        console.log(`  ↳ hub S ← ${livePrice} · ${hubNote.slice(0, 48)}`);
      } else {
        console.log(`  ↳ hub write FAIL · ${String(row.name || "").slice(0, 28)}`);
      }
    } else if (!row.posId && livePrice != null) {
      console.log(`  ↳ no posId — skip hub · ${String(row.name || "").slice(0, 28)}`);
    } else if (row.status === "blocked_24h" || row.blocked24h || row.status === "blocked_popup") {
      console.log(`  ↳ skip cooldown · ${String(row.name || "").slice(0, 28)}`);
    } else if (row.status === "verify_fail") {
      console.log(`  ↳ verify fail (live still ${row.before}) · ${String(row.name || "").slice(0, 28)}`);
    }

    writeFileSync(TRACKER, JSON.stringify(tracker, null, 2) + "\n");
  });
  persistChain = job.then(
    () => undefined,
    () => undefined,
  );
  return job.catch((err) => {
    console.warn(`persistRow fail:`, err?.message || err);
  });
}

function formatRowLog(r, item, i, total) {
  const storeBit = item.storePrice != null ? ` · หน้าร้าน ${item.storePrice}` : "";
  const verifyBit = r.verified ? " ✓live" : r.verifyRead != null ? ` verify=${r.verifyRead}` : "";
  console.log(
    `[${i + 1}/${total}] ${r.status}: ${item.name.slice(0, 32)} ${r.before ?? item.current}→${r.attempted ?? item.applyPrice} (เป้า ${item.target}${storeBit})${verifyBit}`,
  );
  if (r.popupText && /24 ชั่วโมง|15%|โปรโมชัน|ผิดพลาด/i.test(r.popupText)) {
    console.log(`  popup: ${r.popupText.slice(0, 120).replace(/\n/g, " ")}`);
  }
}

async function runOneRound({ apply, workers, limit, from, source, tracker, pipeline, skipCooldown, retryPopup, category }) {
  const plan =
    source === "baseline" ? loadPlanBaseline(tracker) : await loadPlanHub(tracker);
  let planned = plan.todo;
  if (category) {
    const q = String(category).toLowerCase();
    planned = planned.filter((row) => {
      const cat = String(row.categoryName || row.category || "").toLowerCase();
      return cat.includes(q);
    });
    console.log(`Category filter "${category}" → ${planned.length}/${plan.todo.length} off-target`);
  }
  const channelLiveItems = await loadHubChannelLiveItems();
  const { todo: filtered, skippedCooldown } = filterTodo(planned, tracker, {
    skipCooldown,
    retryPopup,
    channelLiveItems,
  });
  const todo = filtered.slice(from, from + (Number.isFinite(limit) ? limit : 9999));
  const ruleBit =
    source === "hub" && plan.meta?.shopeeRule
      ? ` · Shopee ${formatRule(plan.meta.shopeeRule)}`
      : "";
  const modeBit = pipeline ? " · pipeline" : ` · parallel×${workers}`;
  const catBit = category ? ` · cat=${category}` : "";
  console.log(
    `=== Shopee price ×${workers} ${apply ? "APPLY" : "DRY-RUN"} (target=${source}${ruleBit}${modeBit}${catBit} · max ${MAX_STEP_PCT * 100}%/save · hub-per-row) ===`,
  );
  console.log(
    `Queue: ${todo.length} · off-target ${planned.length} · skip-24h ${skippedCooldown} · matched ${plan.meta?.matched ?? "?"} · at-target ${plan.meta?.atTarget ?? "?"} · >15% need more steps: ${todo.filter((t) => (t.diffPct || 0) > MAX_STEP_PCT).length}`,
  );

  if (!todo.length) {
    return { log: [], todo: [], empty: true, skippedCooldown };
  }

  const { windowIndex, tabIndex: baseTab } = findShopeeTab();
  const started = Date.now();
  const round = (tracker.round || 0) + (apply ? 1 : 0);
  const log = [];

  if (pipeline || workers <= 1) {
    const tabIndex = baseTab;
    for (let i = 0; i < todo.length; i++) {
      const item = todo[i];
      const r = await updateOne(tabIndex, item, apply, windowIndex);
      const row = { ...r, at: new Date().toISOString() };
      formatRowLog(row, item, i, todo.length);
      if (apply) await persistRow(tracker, row, round);
      log.push(row);
    }
  } else {
    console.log(`Opening ${workers} Chrome tabs…`);
    const pooled = await mapPool(todo, workers, async (tabIndex, item, i, wi) => {
      const r = await updateOne(tabIndex, item, apply, wi);
      const row = { ...r, at: new Date().toISOString() };
      formatRowLog(row, item, i, todo.length);
      // ไม่รอ persist จบก่อนหยิบรายการถัดไป — hub เขียนคิวแยก (ตารางอัปเดตทันที)
      if (apply) void persistRow(tracker, row, round);
      return row;
    });
    log.push(...pooled);
    // รอ hub/tracker ของแถวสุดท้ายให้ครบก่อนสรุป
    await persistChain;
  }

  writeFileSync(
    LOG,
    JSON.stringify(
      { at: new Date().toISOString(), round, apply, workers, pipeline, source, skippedCooldown, log },
      null,
      2,
    ) + "\n",
  );

  const stats = {
    updated: log.filter((r) => r.verified && r.changed).length,
    reached: log.filter((r) => r.status === "reached_target" || r.status === "skip_at_target").length,
    blocked: log.filter((r) => r.status === "blocked_popup" || r.status === "blocked_promo" || r.status === "blocked_24h").length,
    blocked24h: log.filter((r) => r.status === "blocked_24h").length,
    verifyFail: log.filter((r) => r.status === "verify_fail").length,
    noChange: log.filter((r) => r.status === "no_change").length,
    errors: log.filter((r) => r.status === "error").length,
    stepped: log.filter((r) => r.verified && r.changed && r.after !== r.target).length,
  };
  console.log(
    `\nDone in ${Math.round((Date.now() - started) / 1000)}s · verified ${stats.updated} · ถึงเป้า ${stats.reached} · ขั้นกลาง ${stats.stepped} · blocked ${stats.blocked} (24h ${stats.blocked24h}) · verify-fail ${stats.verifyFail} · error ${stats.errors}`,
  );
  console.log(`→ ${LOG}`);
  if (apply) console.log(`→ ${TRACKER}`);
  return { log, todo, empty: false, stats, skippedCooldown };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const workersArg = process.argv.find((a) => a.startsWith("--workers="));
  const pipeline = process.argv.includes("--pipeline");
  // apply ปกติ = มัลติแท็บ; ใส่ --pipeline ถ้าอยากทีละแท็บ
  const parallel = !pipeline && (apply || process.argv.includes("--parallel"));
  const workers = workersArg
    ? Math.min(10, Math.max(1, Number(workersArg.slice("--workers=".length))))
    : parallel
      ? 4
      : 1;
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const fromArg = process.argv.find((a) => a.startsWith("--from="));
  const sourceArg = process.argv.find((a) => a.startsWith("--source="));
  const categoryArg = process.argv.find((a) => a.startsWith("--category="));
  const source = sourceArg ? sourceArg.slice("--source=".length) : "hub";
  const category = categoryArg ? categoryArg.slice("--category=".length) : "";
  const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : Infinity;
  const from = fromArg ? Number(fromArg.slice("--from=".length)) : 0;
  const skipCooldown = !process.argv.includes("--force-cooldown");
  const retryPopup = process.argv.includes("--retry-popup");

  if (apply && process.argv.includes("--sync-table-note")) {
    const added = await ensureShopeePipelineTableNote();
    if (added) console.log("→ appended Shopee pipeline to menuPriceHub/settings.tableNote");
  }

  const tracker = loadTracker();
  const last = await runOneRound({
    apply,
    workers,
    limit,
    from,
    source,
    tracker,
    pipeline,
    skipCooldown,
    retryPopup,
    category,
  });
  if (last.empty) {
    console.log("Nothing left off-target (or all in 24h cooldown)");
  }
}

main()
  .catch((e) => {
    console.error("FAIL:", e.message);
    process.exit(1);
  })
  .then(() => process.exit(0));
