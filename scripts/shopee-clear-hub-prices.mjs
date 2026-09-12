#!/usr/bin/env node
/**
 * Clear Shopee live prices on the hub (menus + options) without dropping
 * photo / externalId / groups. Also drop tracker currentLive that looks like
 * API micros so the next scan/apply uses baht.
 *
 *   node scripts/shopee-clear-hub-prices.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { getSeedDb } from "./lib/pos-firebase-seed.mjs";
import { looksLikeShopeeMicros } from "./lib/shopee-money.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const TRACKER = join(__dir, "data/menu-price-baseline/shopee-price-tracker.json");

function clearShopeePrice(obs) {
  if (!obs || typeof obs !== "object") return { obs, changed: false };
  const next = { ...obs };
  let changed = false;
  if (next.price != null) {
    next.price = null;
    changed = true;
  }
  if (looksLikeShopeeMicros(next.targetPrice)) {
    delete next.targetPrice;
    changed = true;
  }
  return { obs: next, changed };
}

function clearBucket(map) {
  let n = 0;
  const out = {};
  for (const [id, row] of Object.entries(map || {})) {
    const nextRow = { ...row };
    if (nextRow.shopee) {
      const { obs, changed } = clearShopeePrice(nextRow.shopee);
      nextRow.shopee = obs;
      if (changed) n += 1;
    }
    out[id] = nextRow;
  }
  return { map: out, n };
}

async function main() {
  const db = await getSeedDb();
  const ref = doc(db, "menuPriceHub", "channelLive");
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    console.log("hub channelLive missing");
    process.exit(0);
  }
  const data = snap.data() || {};
  const items = clearBucket(data.items);
  const options = { map: data.options || {}, n: 0 };
  await setDoc(ref, {
    items: items.map,
    options: options.map,
    unmatched: Array.isArray(data.unmatched) ? data.unmatched : [],
    updatedAt: Date.now(),
  });

  let trackerN = 0;
  if (existsSync(TRACKER)) {
    const tracker = JSON.parse(readFileSync(TRACKER, "utf8"));
    for (const entry of Object.values(tracker.items || {})) {
      if (!entry || typeof entry !== "object") continue;
      if (looksLikeShopeeMicros(entry.currentLive)) {
        delete entry.currentLive;
        trackerN += 1;
      }
    }
    tracker.updatedAt = new Date().toISOString();
    writeFileSync(TRACKER, JSON.stringify(tracker, null, 2) + "\n");
  }

  console.log(
    `cleared Shopee hub menu prices · menus ${items.n} · options kept ${Object.keys(options.map).length} · tracker micros ${trackerN}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FAIL:", e.message);
    process.exit(1);
  });
