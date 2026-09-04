#!/usr/bin/env node
/**
 * Match channel live scans → POS and merge into menuPriceHub/channelLive.
 * Also refreshes src/data/channel-live-prices/live-scans.json for that channel.
 *
 *   node scripts/channel-scan-to-hub.mjs --channel=grab
 *   node scripts/channel-scan-to-hub.mjs --channel=lineman
 *   node scripts/channel-scan-to-hub.mjs --channel=shopee
 *   node scripts/channel-scan-to-hub.mjs --channel=all
 *   node scripts/channel-scan-to-hub.mjs --channel=grab --dry-run
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { getSeedDb } from "./lib/pos-firebase-seed.mjs";
import { isStoreOnlyName } from "./lib/name-sync-match.mjs";
import { normName as normGrab } from "./lib/grab-csv.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dir, "data/menu-price-baseline");
const LIVE_BUNDLE = join(__dir, "../src/data/channel-live-prices/live-scans.json");
const DRY = process.argv.includes("--dry-run");

const CHANNELS = {
  shopee: {
    scan: join(DATA, "shopee-live-scan.json"),
    opts: join(DATA, "shopee-live-options.json"),
    idKey: "dishId",
    priceKey: "listPrice",
  },
  grab: {
    scan: join(DATA, "grab-live-scan.json"),
    opts: join(DATA, "grab-live-scan.json"), // options nested
    idKey: "itemId",
    priceKey: "listPrice",
    optsNested: true,
  },
  lineman: {
    scan: join(DATA, "lineman-live-scan.json"),
    opts: join(DATA, "lineman-live-options.json"),
    idKey: "id",
    priceKey: "listPrice",
  },
};

function normName(s) {
  return normGrab(s);
}

function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function foldOptName(s) {
  return normName(s)
    .replace(/ท้อปปิ้ง/g, "ท็อปปิ้ง")
    .replace(/\s+/g, " ");
}

/** Grab live names that are a known incomplete form of a POS choice. */
const OPT_NAME_ALIASES = new Map([
  ["บุกบราวน์ชูก้า", "บุกบราวน์"],
  ["ซอสบราวน์ชูก้า", "ซอสบราวน์"],
  ["เพิ่มช็อตกาแฟ", "เพิ่มช็อตกาแฟ 1 ช็อต"],
]);

function aliasLiveName(name) {
  const n = foldOptName(name);
  for (const [from, to] of OPT_NAME_ALIASES) {
    if (foldOptName(from) === n) return to;
  }
  return name;
}

function scoreOpt(a, b) {
  const na = foldOptName(a);
  const nb = foldOptName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  return 0;
}

function groupScore(liveGroup, posGroup) {
  const ga = foldOptName(liveGroup);
  const gb = foldOptName(posGroup);
  if (!ga || !gb) return 0;
  if (ga === gb) return 1;
  if (ga.includes(gb) || gb.includes(ga)) return 0.6;
  return 0;
}

function bestOptMatch(liveGroup, liveName, posChoices, usedOpt = new Set()) {
  const unused = posChoices.filter((c) => !usedOpt.has(c.key));
  const aliased = aliasLiveName(liveName);
  const exact = unused.filter(
    (c) => scoreOpt(liveName, c.name) >= 1 || scoreOpt(aliased, c.name) >= 1,
  );
  if (exact.length === 1) return { ...exact[0], score: 1 };
  if (exact.length > 1) {
    let best = null;
    for (const c of exact) {
      const score = 1 + groupScore(liveGroup, c.groupName);
      if (!best || score > best.score) best = { ...c, score };
    }
    return best;
  }

  const na = foldOptName(aliased);
  const contains = unused.filter((c) => {
    const nb = foldOptName(c.name);
    return na && nb && na !== nb && (na.includes(nb) || nb.includes(na));
  });
  if (contains.length === 1) return { ...contains[0], score: 0.85 };
  if (contains.length > 1) {
    let best = null;
    for (const c of contains) {
      const nb = foldOptName(c.name);
      const lenDiff = Math.abs(nb.length - na.length);
      const score = groupScore(liveGroup, c.groupName) * 1000 - lenDiff;
      if (!best || score > best.score) best = { ...c, score };
    }
    return best;
  }
  return null;
}

function loadOptions(cfg) {
  const raw = loadJson(cfg.opts, { options: [] });
  if (cfg.optsNested) return raw.options || [];
  return raw.options || [];
}

function itemPrice(it, priceKey) {
  if (typeof it[priceKey] === "number") return it[priceKey];
  if (typeof it.listPrice === "number") return it.listPrice;
  if (typeof it.displayPrice === "number") return it.displayPrice;
  if (typeof it.price === "number") return it.price;
  return null;
}

async function ingestChannel(channel, db, posItems, posChoices, current) {
  const cfg = CHANNELS[channel];
  const scan = loadJson(cfg.scan, null);
  if (!scan?.items?.length) {
    console.log(`[${channel}] skip — missing scan`);
    return { matchedMenus: 0, unmatchedMenus: 0, matchedOpts: 0, unmatchedOpts: 0 };
  }
  const deliveryPos = posItems.filter(
    (p) => p.active !== false && !isStoreOnlyName(p.name || ""),
  );
  const scannedAt = scan.scannedAt || scan.at || new Date().toISOString();
  const items = { ...(current.items || {}) };
  const options = { ...(current.options || {}) };
  let matchedMenus = 0;
  let unmatchedMenus = 0;
  const usedPos = new Set();
  const posByExt = new Map();
  for (const p of deliveryPos) {
    const ext = items[p.id]?.[channel]?.externalId;
    if (ext) posByExt.set(String(ext), p);
  }

  for (const it of scan.items) {
    const price = itemPrice(it, cfg.priceKey);
    if (!it.name && price == null) {
      unmatchedMenus += 1;
      continue;
    }
    const ext = String(it[cfg.idKey] || it.dishId || it.itemId || it.id || "").trim();
    const byName = deliveryPos.find((p) => !usedPos.has(p.id) && normName(p.name) === normName(it.name));
    const byIdHit = ext ? posByExt.get(ext) : null;
    const byId = byIdHit && !usedPos.has(byIdHit.id) ? byIdHit : null;
    const hit = byName || byId;
    if (!hit) {
      unmatchedMenus += 1;
      continue;
    }
    usedPos.add(hit.id);
    matchedMenus += 1;
    const row = { ...(items[hit.id] || {}) };
    row[channel] = {
      name: it.name || hit.name || "",
      price,
      scannedAt,
      source: "scan",
      externalId: ext || null,
    };
    items[hit.id] = row;
  }

  let matchedOpts = 0;
  let unmatchedOpts = 0;
  const usedOpt = new Set();
  const optList = loadOptions(cfg)
    .slice()
    .sort((a, b) => (Number(b.related) || 0) - (Number(a.related) || 0));
  const optAt = loadJson(cfg.opts, {}).at || scannedAt;
  const optByExt = new Map();
  for (const c of posChoices) {
    const ext = options[c.key]?.[channel]?.externalId;
    if (ext) optByExt.set(String(ext), c);
  }
  for (const o of optList) {
    const ext = String(o.optionId || "").trim();
    const byIdRaw =
      ext && optByExt.has(ext) && !usedOpt.has(optByExt.get(ext).key) ? optByExt.get(ext) : null;
    const byName = bestOptMatch(o.group || "", o.name || "", posChoices, usedOpt);
    const byIdOk =
      byIdRaw &&
      (scoreOpt(o.name, byIdRaw.name) >= 1 || scoreOpt(aliasLiveName(o.name), byIdRaw.name) >= 1)
        ? byIdRaw
        : null;
    const hit = byName || byIdOk;
    if (!hit || usedOpt.has(hit.key)) {
      unmatchedOpts += 1;
      continue;
    }
    usedOpt.add(hit.key);
    matchedOpts += 1;
    const row = { ...(options[hit.key] || {}) };
    const price =
      typeof o.price === "number"
        ? o.price
        : Array.isArray(o.prices) && typeof o.prices[0] === "number"
          ? o.prices[0]
          : null;
    const liveExt =
      (o.optionId && String(o.optionId)) ||
      (o.id && String(o.id)) ||
      (typeof o.url === "string" ? (o.url.match(/id=(\d+)/) || [])[1] || null : null);
    row[channel] = {
      name: o.name || hit.name || "",
      price,
      scannedAt: optAt,
      source: "scan",
      externalId: liveExt,
    };
    options[hit.key] = row;
  }

  // Drop stale live cells for this channel when this scan did not rematch the POS option.
  for (const [key, row] of Object.entries(options)) {
    if (usedOpt.has(key) || !row?.[channel]) continue;
    const next = { ...row };
    delete next[channel];
    if (Object.keys(next).length) options[key] = next;
    else delete options[key];
  }

  Object.assign(current, { items, options });

  // Update bundled live-scans.json for this channel
  const bundle = loadJson(LIVE_BUNDLE, {});
  bundle[channel] = {
    scannedAt,
    count: scan.items.filter((x) => itemPrice(x, cfg.priceKey) != null).length,
    items: scan.items
      .filter((x) => x.name && itemPrice(x, cfg.priceKey) != null)
      .map((x) => ({
        id: String(x[cfg.idKey] || x.dishId || x.itemId || x.id || x.name),
        name: x.name,
        listPrice: itemPrice(x, cfg.priceKey),
      })),
  };
  if (!DRY) writeFileSync(LIVE_BUNDLE, JSON.stringify(bundle, null, 2) + "\n");

  console.log(
    `[${channel}] menus ${matchedMenus} matched / ${unmatchedMenus} unmatched · options ${matchedOpts} / ${unmatchedOpts}`,
  );
  return { matchedMenus, unmatchedMenus, matchedOpts, unmatchedOpts };
}

async function main() {
  const chArg = process.argv.find((a) => a.startsWith("--channel="));
  const raw = chArg ? chArg.slice("--channel=".length) : "all";
  const list =
    raw === "all"
      ? ["shopee", "grab", "lineman"]
      : raw.split(",").map((s) => s.trim()).filter(Boolean);
  for (const ch of list) {
    if (!CHANNELS[ch]) throw new Error(`Unknown channel ${ch}`);
  }

  const db = await getSeedDb();
  const [itemsSnap, groupsSnap, liveSnap] = await Promise.all([
    getDocs(collection(db, "menuItems")),
    getDocs(collection(db, "menuOptionGroups")),
    getDoc(doc(db, "menuPriceHub", "channelLive")),
  ]);
  const posItems = itemsSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
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

  const current = liveSnap.exists()
    ? { items: { ...(liveSnap.data().items || {}) }, options: { ...(liveSnap.data().options || {}) } }
    : { items: {}, options: {} };

  for (const ch of list) {
    await ingestChannel(ch, db, posItems, posChoices, current);
  }

  const next = { ...current, updatedAt: Date.now() };
  if (!DRY) {
    await setDoc(doc(db, "menuPriceHub", "channelLive"), next, { merge: false });
    console.log("wrote Firestore menuPriceHub/channelLive");
  } else {
    console.log("dry-run — no write");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FAIL:", e.message);
    process.exit(1);
  });
