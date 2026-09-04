#!/usr/bin/env node
/**
 * Match Shopee live scan (+ options) → POS ids and write menuPriceHub/channelLive.
 * Also refreshes src/data/channel-live-prices/live-scans.json (shopee items).
 *
 *   node scripts/shopee-scan-to-hub.mjs
 *   node scripts/shopee-scan-to-hub.mjs --dry-run
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { getSeedDb } from "./lib/pos-firebase-seed.mjs";
import { bestPosForGrab, isStoreOnlyName } from "./lib/name-sync-match.mjs";
import { normName } from "./lib/shopee-chrome.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const SCAN = join(__dir, "data/menu-price-baseline/shopee-live-scan.json");
const OPTS = join(__dir, "data/menu-price-baseline/shopee-live-options.json");
const LIVE_BUNDLE = join(__dir, "../src/data/channel-live-prices/live-scans.json");
const DRY = process.argv.includes("--dry-run");

function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
}

function scoreOpt(a, b) {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  return 0;
}

function bestOptMatch(liveGroup, liveName, posChoices) {
  let best = null;
  for (const c of posChoices) {
    const nameScore = scoreOpt(liveName, c.name);
    if (nameScore < 0.85) continue;
    const groupScore = scoreOpt(liveGroup, c.groupName);
    const score = nameScore * 0.7 + groupScore * 0.3;
    if (!best || score > best.score) best = { ...c, score };
  }
  // fallback: exact choice name only if unique
  if (!best) {
    const exact = posChoices.filter((c) => scoreOpt(liveName, c.name) >= 1);
    if (exact.length === 1) best = { ...exact[0], score: 0.9 };
  }
  return best;
}

async function main() {
  const scan = loadJson(SCAN, null);
  if (!scan?.items?.length) throw new Error(`Missing/empty ${SCAN} — run shopee-chrome-scan first`);
  const optScan = loadJson(OPTS, { options: [] });

  const db = await getSeedDb();
  const [itemsSnap, groupsSnap, liveSnap] = await Promise.all([
    getDocs(collection(db, "menuItems")),
    getDocs(collection(db, "menuOptionGroups")),
    getDoc(doc(db, "menuPriceHub", "channelLive")),
  ]);

  const posItems = itemsSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  const deliveryPos = posItems.filter((p) => p.active !== false && !isStoreOnlyName(p.name || ""));

  const posChoices = [];
  for (const d of groupsSnap.docs) {
    const g = d.data() || {};
    if (g.active === false) continue;
    for (const c of g.options || []) {
      if (c.active === false) continue;
      posChoices.push({
        key: `${d.id}::${c.id}`,
        groupId: d.id,
        groupName: g.name || "",
        choiceId: c.id,
        name: c.name || "",
      });
    }
  }

  const scannedAt = scan.scannedAt || new Date().toISOString();
  const current = liveSnap.exists()
    ? liveSnap.data()
    : { items: {}, options: {} };
  const items = { ...(current.items || {}) };
  const options = { ...(current.options || {}) };

  let matchedMenus = 0;
  let unmatchedMenus = 0;
  const usedPos = new Set();

  for (const it of scan.items) {
    if (it.listPrice == null && !it.name) {
      unmatchedMenus += 1;
      continue;
    }
    const hit =
      deliveryPos.find((p) => normName(p.name) === normName(it.name)) ||
      bestPosForGrab(it.name, deliveryPos, { minScore: 0.55 });
    if (!hit || usedPos.has(hit.id)) {
      unmatchedMenus += 1;
      continue;
    }
    usedPos.add(hit.id);
    matchedMenus += 1;
    const row = { ...(items[hit.id] || {}) };
    row.shopee = {
      name: it.name || hit.name || "",
      price: typeof it.listPrice === "number" ? it.listPrice : null,
      scannedAt,
      source: "scan",
      externalId: it.dishId ? String(it.dishId) : null,
    };
    items[hit.id] = row;
  }

  let matchedOpts = 0;
  let unmatchedOpts = 0;
  const usedOpt = new Set();
  for (const o of optScan.options || []) {
    const hit = bestOptMatch(o.group || "", o.name || "", posChoices);
    if (!hit || usedOpt.has(hit.key)) {
      unmatchedOpts += 1;
      continue;
    }
    usedOpt.add(hit.key);
    matchedOpts += 1;
    const row = { ...(options[hit.key] || {}) };
    const ext =
      typeof o.url === "string" ? (o.url.match(/id=(\d+)/) || [])[1] || null : null;
    row.shopee = {
      name: o.name || hit.name || "",
      price: typeof o.price === "number" ? o.price : null,
      scannedAt: optScan.at || scannedAt,
      source: "scan",
      externalId: ext,
    };
    options[hit.key] = row;
  }

  const next = {
    items,
    options,
    updatedAt: Date.now(),
  };

  console.log(
    `menus matched ${matchedMenus} · unmatched ${unmatchedMenus} · options matched ${matchedOpts} · unmatched ${unmatchedOpts}`,
  );

  if (!DRY) {
    await setDoc(doc(db, "menuPriceHub", "channelLive"), next, { merge: false });
    console.log("wrote Firestore menuPriceHub/channelLive");

    // Refresh bundled shopee snapshot used as hub fallback
    const bundle = loadJson(LIVE_BUNDLE, {});
    bundle.shopee = {
      scannedAt,
      count: scan.items.filter((x) => x.listPrice != null).length,
      items: scan.items
        .filter((x) => x.name && x.listPrice != null)
        .map((x) => ({
          id: String(x.dishId || x.name),
          name: x.name,
          listPrice: x.listPrice,
        })),
    };
    writeFileSync(LIVE_BUNDLE, JSON.stringify(bundle, null, 2) + "\n");
    console.log(`updated ${LIVE_BUNDLE}`);
  } else {
    console.log("dry-run — no write");
  }
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
