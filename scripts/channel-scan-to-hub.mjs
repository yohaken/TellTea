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
import { namesEqual, normName as normGrab } from "./lib/grab-csv.mjs";

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

function bestOptMatch(liveGroup, liveName, posChoices, usedOpt = new Set()) {
  const unused = posChoices.filter((c) => !usedOpt.has(c.key));
  return unused.find((c) => namesEqual(liveName, c.name) && namesEqual(liveGroup, c.groupName)) || null;
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

function liveGroupNames(it) {
  const raw = it.optionGroupNames || it.option_group_names || it.optionGroups || [];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => (typeof x === "string" ? x : x?.name || x?.group || ""))
    .map((s) => String(s || "").trim())
    .filter(Boolean);
}

function choiceIndexByOption(optList) {
  const map = new Map();
  const seen = new Map();
  for (const o of optList) {
    const g = o.group || "";
    const i = seen.get(g) || 0;
    seen.set(g, i + 1);
    const ext = String(o.optionId || o.id || "").trim();
    if (ext) map.set(`id:${ext}`, i);
    map.set(`name:${normName(g)}|${normName(o.name || "")}`, i);
  }
  return map;
}

function unmatchedId(channel, kind, ext, name, group, seen) {
  let id = `${channel}:${kind}:${ext || ""}:${normName(name)}:${normName(group || "")}`;
  if (seen.has(id)) {
    let n = 2;
    while (seen.has(`${id}#${n}`)) n += 1;
    id = `${id}#${n}`;
  }
  seen.add(id);
  return id;
}

function classifyItemReason(name) {
  return /^\s*ลบไม่ได้/.test(name || "") ? "hidden" : "extra";
}

function classifyOptReason(o, matchedNameGroups, posChoices) {
  const g = o.group || "";
  const n = o.name || "";
  if (matchedNameGroups.has(`${normName(g)}|${normName(n)}`)) return "duplicate";
  if (posChoices.some((c) => namesEqual(c.groupName, g))) return "unmatched_name";
  return "extra";
}

const GRAB_PROTECTED_GROUPS = new Set([
  "THMOG20260901152504029308",
  "THMOG20260901152504018148",
]);

function optionIsLinked(o) {
  return o.linked === true || (Number(o.related) || 0) > 0;
}

async function ingestChannel(channel, db, posItems, posChoices, current, posCatNames = []) {
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
  const unmatchedEntries = [];
  const unmatchedSeen = new Set();
  let matchedMenus = 0;
  let unmatchedMenus = 0;
  const usedPos = new Set();
  const posByExt = new Map();
  for (const p of deliveryPos) {
    const ext = items[p.id]?.[channel]?.externalId;
    if (ext) posByExt.set(String(ext), p);
  }

  for (const [i, it] of scan.items.entries()) {
    const price = itemPrice(it, cfg.priceKey);
    if (!it.name && price == null) {
      unmatchedMenus += 1;
      continue;
    }
    const ext = String(it[cfg.idKey] || it.dishId || it.itemId || it.id || "").trim();
    const byName = deliveryPos.find((p) => !usedPos.has(p.id) && namesEqual(p.name, it.name));
    const byIdHit = ext ? posByExt.get(ext) : null;
    const byId = byIdHit && !usedPos.has(byIdHit.id) ? byIdHit : null;
    const hit = byName || byId;
    if (!hit) {
      unmatchedMenus += 1;
      unmatchedEntries.push({
        id: unmatchedId(channel, "item", ext, it.name || "", it.category || "", unmatchedSeen),
        kind: "item",
        channel,
        name: it.name || "(ไม่มีชื่อ)",
        group: it.category || null,
        price,
        externalId: ext || null,
        reason: classifyItemReason(it.name || ""),
        cleanAction: /^\s*ลบไม่ได้/.test(it.name || "") ? "blocked" : "review",
        scannedAt,
      });
      continue;
    }
    usedPos.add(hit.id);
    matchedMenus += 1;
    const groupNames = liveGroupNames(it);
    const row = { ...(items[hit.id] || {}) };
    row[channel] = {
      name: it.name || "",
      price,
      scannedAt,
      source: "scan",
      externalId: ext || null,
      category: it.category || "",
      sortIndex: Number.isFinite(Number(it.sortIndex)) ? Number(it.sortIndex) : i,
      ...(groupNames.length ? { groupNames } : {}),
    };
    items[hit.id] = row;
  }

  let matchedOpts = 0;
  let unmatchedOpts = 0;
  const usedOpt = new Set();
  const leftoverOpts = [];
  const optListRaw = loadOptions(cfg);
  const choiceIndexMap = choiceIndexByOption(optListRaw);
  const optList = optListRaw
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
    const hit = byName || byIdRaw;
    if (!hit || usedOpt.has(hit.key)) {
      unmatchedOpts += 1;
      leftoverOpts.push(o);
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
    const choiceIndex =
      (liveExt && choiceIndexMap.get(`id:${liveExt}`)) ??
      choiceIndexMap.get(`name:${normName(o.group || "")}|${normName(o.name || "")}`);
    row[channel] = {
      name: o.name || "",
      price,
      scannedAt: optAt,
      source: "scan",
      externalId: liveExt,
      category: o.group || "",
      ...(Number.isFinite(choiceIndex) ? { choiceIndex } : {}),
    };
    options[hit.key] = row;
  }

  const matchedNameGroups = new Set();
  for (const c of posChoices) {
    if (!usedOpt.has(c.key)) continue;
    matchedNameGroups.add(`${normName(c.groupName)}|${normName(c.name)}`);
  }
  const usedGroupNames = new Set();
  for (const o of optList) {
    if (optionIsLinked(o)) usedGroupNames.add(normName(o.group || ""));
  }

  function pushLeftoverChoice(o) {
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
    const reason = classifyOptReason(o, matchedNameGroups, posChoices);
    unmatchedEntries.push({
      id: unmatchedId(channel, "option", liveExt, o.name || "", o.group || "", unmatchedSeen),
      kind: "option",
      channel,
      name: o.name || "(ไม่มีชื่อ)",
      group: o.group || null,
      price,
      externalId: liveExt,
      ...(typeof o.related === "number" && Number.isFinite(o.related) ? { related: o.related } : {}),
      reason,
      cleanAction: optionIsLinked(o) ? "review" : reason === "duplicate" ? "delete_orphan" : "review",
      scannedAt: optAt,
    });
  }

  if (channel === "grab") {
    const leftoverByGroup = new Map();
    for (const o of leftoverOpts) {
      const gid = String(o.groupId || `name:${normName(o.group || "")}`);
      if (!leftoverByGroup.has(gid)) leftoverByGroup.set(gid, []);
      leftoverByGroup.get(gid).push(o);
    }
    for (const [gid, list] of leftoverByGroup) {
      const sample = list[0];
      const linked = list.some((x) => optionIsLinked(x));
      if (linked) {
        for (const o of list) pushLeftoverChoice(o);
        continue;
      }
      const gname = sample.group || "";
      const hasUsedSibling = usedGroupNames.has(normName(gname));
      const protectedG = GRAB_PROTECTED_GROUPS.has(gid);
      const cleanAction = protectedG
        ? "blocked"
        : hasUsedSibling
          ? "delete_orphan"
          : "skip_only_copy";
      unmatchedEntries.push({
        id: unmatchedId(channel, "option", gid, gname, "group", unmatchedSeen),
        kind: "option",
        channel,
        name: gname || "(ไม่มีชื่อกลุ่ม)",
        group: `สำเนา · ${list.length} ตัวเลือก · ผูก 0 เมนู`,
        price: null,
        externalId: gid.startsWith("name:") ? null : gid,
        related: 0,
        reason: hasUsedSibling ? "duplicate" : "extra",
        cleanAction,
        scannedAt: optAt,
      });
    }
  } else {
    for (const o of leftoverOpts) pushLeftoverChoice(o);
  }

  // Drop stale live cells for this channel when this scan did not rematch the POS option.
  for (const [key, row] of Object.entries(options)) {
    if (usedOpt.has(key) || !row?.[channel]) continue;
    const next = { ...row };
    delete next[channel];
    if (Object.keys(next).length) options[key] = next;
    else delete options[key];
  }

  for (const c of scan.categories || []) {
    const name = c.name || c.categoryName || "";
    if (!name) continue;
    const itemCount = Number(c.itemCount ?? c.n) || 0;
    const posHit = posCatNames.some((p) => namesEqual(p, name));
    if (posHit && itemCount > 0) continue;
    unmatchedEntries.push({
      id: unmatchedId(channel, "category", c.id || c.categoryID, name, "", unmatchedSeen),
      kind: "category",
      channel,
      name,
      group: itemCount ? `${itemCount} เมนู` : "ว่าง",
      price: null,
      externalId: c.id || c.categoryID || null,
      reason: itemCount === 0 ? "extra" : "unmatched_name",
      cleanAction: itemCount === 0 ? "delete_empty_cat" : "review",
      scannedAt,
    });
  }

  Object.assign(current, {
    items,
    options,
    unmatched: [
      ...(current.unmatched || []).filter((e) => e.channel !== channel),
      ...unmatchedEntries,
    ],
  });

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
    `[${channel}] menus ${matchedMenus} matched / ${unmatchedMenus} unmatched · options ${matchedOpts} / ${unmatchedOpts} · extras ${unmatchedEntries.length}`,
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
  const [itemsSnap, groupsSnap, catsSnap, liveSnap] = await Promise.all([
    getDocs(collection(db, "menuItems")),
    getDocs(collection(db, "menuOptionGroups")),
    getDocs(collection(db, "menuCategories")),
    getDoc(doc(db, "menuPriceHub", "channelLive")),
  ]);
  const posItems = itemsSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  const posCatNames = catsSnap.docs
    .map((d) => d.data() || {})
    .filter((c) => c.active !== false)
    .map((c) => c.name || "")
    .filter(Boolean);
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
    ? {
        items: { ...(liveSnap.data().items || {}) },
        options: { ...(liveSnap.data().options || {}) },
        unmatched: Array.isArray(liveSnap.data().unmatched) ? [...liveSnap.data().unmatched] : [],
      }
    : { items: {}, options: {}, unmatched: [] };

  for (const ch of list) {
    await ingestChannel(ch, db, posItems, posChoices, current, posCatNames);
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
