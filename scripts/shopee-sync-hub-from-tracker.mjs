#!/usr/bin/env node
/**
 * Backfill menuPriceHub/channelLive + menuItems.hubNote from shopee-price-tracker.json.
 * Use after ad-hoc applies that didn't write hub, or to refresh notes/timestamps.
 *
 *   node scripts/shopee-sync-hub-from-tracker.mjs
 *   node scripts/shopee-sync-hub-from-tracker.mjs --dry-run
 *   node scripts/shopee-sync-hub-from-tracker.mjs --sync-table-note
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  writeHubLiveFromApplyResult,
  writeMenuItemHubNote,
  ensureShopeePipelineTableNote,
} from "./lib/hub-live-write.mjs";
import { mapShopeeScanToPos } from "./lib/hub-channel-targets.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const TRACKER = join(__dir, "data/menu-price-baseline/shopee-price-tracker.json");
const SCAN = join(__dir, "data/menu-price-baseline/shopee-live-scan.json");

function fmtShortTs(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatHubNoteFromEntry(entry) {
  const live = entry.currentLive;
  const target = entry.targetPrice;
  const last = entry.rounds?.at(-1);
  const ts = fmtShortTs(last?.at || entry.updatedAt);
  if (live == null) return `S ? ${ts}`;
  if (live === target) return `S:${live} ✓ ${ts}`;
  const inCooldown = entry.cooldownUntil && Date.now() < Date.parse(entry.cooldownUntil);
  if (inCooldown) {
    const cd = fmtShortTs(entry.cooldownUntil);
    return `S:${live}→${target} ⏳24h~${cd || ts}`;
  }
  if (last?.verified && last?.changed) return `S:${live}→${target} ✓step ${ts}`;
  if (last?.status === "verify_fail") return `S:${live}→${target} ?verify ${ts}`;
  if (last?.status === "blocked_promo") return `S:${live}→${target} ⏳promo ${ts}`;
  if (last?.status === "blocked_popup" || last?.status === "blocked_24h") {
    return `S:${live}→${target} ⏳popup ${ts}`;
  }
  return `S:${live}→${target} ${ts}`;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (!existsSync(TRACKER)) throw new Error(`Missing ${TRACKER}`);

  if (process.argv.includes("--sync-table-note") && !dryRun) {
    const added = await ensureShopeePipelineTableNote();
    console.log(added ? "→ tableNote updated" : "→ tableNote already has Shopee section");
  }

  const tracker = JSON.parse(readFileSync(TRACKER, "utf8"));
  const scan = existsSync(SCAN) ? JSON.parse(readFileSync(SCAN, "utf8")) : { items: [] };
  const posMap = await mapShopeeScanToPos(scan.items || []);
  const items = tracker.items || {};
  let n = 0;
  let skipped = 0;

  for (const entry of Object.values(items)) {
    const mapped = posMap.get(String(entry.dishId || ""));
    const posId = entry.posId || mapped?.posId;
    const live = entry.currentLive;
    if (!posId || live == null || !Number.isFinite(Number(live))) {
      skipped++;
      continue;
    }
    if (!entry.posId) entry.posId = posId;
    if (entry.targetPrice == null && mapped?.target != null) entry.targetPrice = mapped.target;
    const last = entry.rounds?.at(-1);
    const hubNote = formatHubNoteFromEntry(entry);
    const payload = {
      posId,
      name: entry.name,
      dishId: entry.dishId,
      target: entry.targetPrice,
      before: last?.before ?? live,
      after: live,
      verifyRead: last?.verifyRead ?? live,
      verified: !!last?.verified,
      changed: !!last?.changed,
      status: last?.status || (entry.reachedTarget ? "reached_target" : "sync"),
      at: last?.at || tracker.updatedAt || new Date().toISOString(),
      applyNote: hubNote,
      hubNote,
      cooldownUntil: entry.cooldownUntil || null,
    };

    if (dryRun) {
      console.log(`${entry.name?.slice(0, 32) || posId}: ${hubNote}`);
      n++;
      continue;
    }

    const ok = await writeHubLiveFromApplyResult("shopee", payload);
    if (ok) {
      await writeMenuItemHubNote(posId, hubNote);
      n++;
      if (n % 10 === 0) console.log(`… ${n} synced`);
    } else {
      skipped++;
    }
  }

  console.log(`Done · synced ${n} · skipped ${skipped}${dryRun ? " (dry-run)" : ""}`);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
