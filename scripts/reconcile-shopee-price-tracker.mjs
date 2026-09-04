#!/usr/bin/env node
/**
 * Fix tracker round history using post-rescan live prices (truth source).
 *
 *   node scripts/reconcile-shopee-price-tracker.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const TRACKER = join(__dir, "data/menu-price-baseline/shopee-price-tracker.json");
const SCAN = join(__dir, "data/menu-price-baseline/shopee-live-scan.json");

const tracker = JSON.parse(readFileSync(TRACKER, "utf8"));
const scan = JSON.parse(readFileSync(SCAN, "utf8"));
const liveById = new Map((scan.items || []).map((i) => [String(i.dishId), Number(i.listPrice)]));

let fixed = 0;
for (const rec of Object.values(tracker.items)) {
  const live = liveById.get(String(rec.dishId));
  if (!Number.isFinite(live)) continue;
  rec.currentLive = live;
  rec.reachedTarget = live === rec.targetPrice;
  for (const r of rec.rounds || []) {
    const promo = /โปรโมชัน|promotion/i.test(r.popupText || "");
    const actuallyChanged = Number.isFinite(r.before) && live !== r.before;
    if (promo && !actuallyChanged) {
      r.status = "blocked_promo";
      r.changed = false;
      r.after = live;
      fixed++;
    } else if (Number.isFinite(r.after) && r.after !== live) {
      r.after = live;
      r.changed = actuallyChanged;
      if (live === rec.targetPrice) r.status = "reached_target";
      else if (!actuallyChanged) r.status = "no_change";
      fixed++;
    }
  }
}

tracker.reconciledAt = new Date().toISOString();
writeFileSync(TRACKER, JSON.stringify(tracker, null, 2) + "\n");
console.log(`Reconciled tracker — ${fixed} round entries corrected using live scan`);
