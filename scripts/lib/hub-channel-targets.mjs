/**
 * Hub channel price targets from POS store price + menuPriceHub/settings.
 * Used by Grab/Shopee/LINE MAN apply scripts.
 * Main channel uses its GP/rule; followers = main target + add (% or ฿).
 */
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { getSeedDb } from "./pos-firebase-seed.mjs";
import { isStoreOnlyName } from "./name-sync-match.mjs";
import { normName, foldMenuName } from "./grab-csv.mjs";

const DELIVERY_CHANNELS = ["shopee", "grab", "lineman"];
const DEFAULT_CHANNEL_RULES = {
  shopee: { mode: "gp", value: 22 },
  grab: { mode: "gp", value: 30 },
  lineman: { mode: "gp", value: 30 },
};
const DEFAULT_MAIN_CHANNEL = "shopee";
const DEFAULT_FOLLOWER_ADD = {
  grab: { mode: "offset", value: 0 },
  lineman: { mode: "offset", value: 0 },
};

/** exact + พับวงเล็บ — ให้คิว apply เห็นรายการที่ ingest จับคู่ได้แล้ว */
function buildPosNameIndexes(items) {
  const byExact = new Map();
  const byFold = new Map();
  for (const it of items) {
    const n = normName(it.name);
    if (n) byExact.set(n, it);
    const f = foldMenuName(it.name);
    if (!f) continue;
    if (!byFold.has(f)) byFold.set(f, []);
    byFold.get(f).push(it);
  }
  return { byExact, byFold };
}

function findPosByScanName(indexes, liveName) {
  const exact = indexes.byExact.get(normName(liveName));
  if (exact) return exact;
  const fold = foldMenuName(liveName);
  if (!fold) return null;
  const hits = indexes.byFold.get(fold) || [];
  return hits.length === 1 ? hits[0] : null;
}

export function applyChannelRule(base, rule) {
  const value = Number(rule?.value) || 0;
  const mode = rule?.mode || "offset";
  let raw;
  if (mode === "absolute") raw = value;
  else if (mode === "percent") raw = base * (1 + value / 100);
  else if (mode === "gp") {
    const gp = Math.min(99.9, Math.max(0, value));
    const keep = 1 - gp / 100;
    raw = keep > 0 ? base / keep : base;
  } else raw = base + value;
  return Math.max(0, Math.round(raw));
}

export function resolveMainChannel(settings) {
  const m = settings?.mainChannel;
  if (m === "shopee" || m === "grab" || m === "lineman") return m;
  const channels = settings?.channels || {};
  let best = DEFAULT_MAIN_CHANNEL;
  let bestGp = Infinity;
  for (const ch of DELIVERY_CHANNELS) {
    const rule = channels[ch] || DEFAULT_CHANNEL_RULES[ch];
    if (rule.mode !== "gp") continue;
    const gp = Number(rule.value) || 0;
    if (gp < bestGp) {
      bestGp = gp;
      best = ch;
    }
  }
  return best;
}

export function resolveFollowerAdd(settings, channel) {
  const raw = settings?.followerAdd?.[channel];
  if (raw && (raw.mode === "percent" || raw.mode === "offset")) {
    return { mode: raw.mode, value: Number(raw.value) || 0 };
  }
  return DEFAULT_FOLLOWER_ADD[channel] || { mode: "offset", value: 0 };
}

export function applyFollowerAdd(mainTarget, add) {
  const base = Math.max(0, Number(mainTarget) || 0);
  const value = Number(add?.value) || 0;
  const raw = add?.mode === "percent" ? base * (1 + value / 100) : base + value;
  return Math.max(0, Math.round(raw));
}

/** เป้า hub ตาม main + add (หรือ override เซลล์) */
export function resolveHubItemTarget(pos, channel, ctx) {
  const base = Math.max(0, Number(pos.price) || 0);
  const override = ctx.itemOverrides?.[pos.id]?.[channel];
  if (override) {
    return {
      target: applyChannelRule(base, override),
      rule: override,
      fromOverride: true,
      viaFollower: false,
    };
  }
  const main = resolveMainChannel(ctx);
  const channels = ctx.channels || {};
  if (channel === main) {
    const rule = channels[channel] || DEFAULT_CHANNEL_RULES[channel];
    return {
      target: applyChannelRule(base, rule),
      rule,
      fromOverride: false,
      viaFollower: false,
    };
  }
  const mainOverride = ctx.itemOverrides?.[pos.id]?.[main];
  const mainRule = channels[main] || DEFAULT_CHANNEL_RULES[main];
  const mainTarget = applyChannelRule(base, mainOverride || mainRule);
  const add = resolveFollowerAdd(ctx, channel);
  return {
    target: applyFollowerAdd(mainTarget, add),
    rule: add,
    fromOverride: false,
    viaFollower: true,
  };
}

export async function loadHubChannelContext() {
  const db = await getSeedDb();
  const [settingsSnap, itemsSnap, catsSnap] = await Promise.all([
    getDoc(doc(db, "menuPriceHub", "settings")),
    getDocs(collection(db, "menuItems")),
    getDocs(collection(db, "menuCategories")),
  ]);
  const settings = settingsSnap.exists() ? settingsSnap.data() : {};
  const channels = settings.channels || {};
  const itemOverrides = settings.itemOverrides || {};
  const optionOverrides = settings.optionOverrides || {};
  const mainChannel = resolveMainChannel(settings);
  const followerAdd = settings.followerAdd || { ...DEFAULT_FOLLOWER_ADD };
  const catName = new Map();
  for (const d of catsSnap.docs) {
    catName.set(d.id, d.data()?.name || "");
  }
  const items = [];
  for (const d of itemsSnap.docs) {
    const data = d.data() || {};
    if (data.active === false) continue;
    const categoryId = data.categoryId || "";
    items.push({
      id: d.id,
      name: data.name || "",
      price: Number(data.price) || 0,
      storeOnly: !!data.storeOnly || isStoreOnlyName(data.name || ""),
      categoryId,
      categoryName: catName.get(categoryId) || "",
      hubNote: typeof data.hubNote === "string" ? data.hubNote.trim() : "",
    });
  }
  return {
    channels,
    itemOverrides,
    optionOverrides,
    mainChannel,
    followerAdd,
    items,
  };
}

/**
 * Build Grab apply plan rows from live scan + hub targets.
 * @returns {{ todo: object[], meta: object }}
 */
export async function buildGrabHubPlan(
  scanItems,
  { tracker = { items: {} }, retryBlocked = false, noteFilter = "", includeAtTarget = false } = {},
) {
  const ctx = await loadHubChannelContext();
  const { channels, items } = ctx;
  const grabRule = channels.grab || { mode: "offset", value: 0 };
  const posIndex = buildPosNameIndexes(items);
  const noteNeedle = String(noteFilter || "").trim().toLowerCase();

  const todo = [];
  let matched = 0;
  let storeOnlySkip = 0;
  let atTarget = 0;
  let blockedSkip = 0;
  let noteSkip = 0;

  for (const it of scanItems || []) {
    const pos = findPosByScanName(posIndex, it.name);
    if (!pos) continue;
    matched++;
    if (noteNeedle && !(pos.hubNote || "").toLowerCase().includes(noteNeedle)) {
      noteSkip++;
      continue;
    }
    if (pos.storeOnly) {
      storeOnlySkip++;
      continue;
    }
    const resolved = resolveHubItemTarget(pos, "grab", ctx);
    const target = resolved.target;
    const rule = resolved.rule;
    const base = Math.max(0, Number(pos.price) || 0);
    const entry = tracker.items?.[it.itemId] || tracker.items?.[it.name];
    const fromTracker = entry?.currentLive;
    const current =
      fromTracker != null && Number.isFinite(Number(fromTracker))
        ? Number(fromTracker)
        : Number(it.listPrice);
    if (!Number.isFinite(current)) continue;
    if (current === target) {
      atTarget++;
      if (!includeAtTarget) continue;
    }
    const last = entry?.rounds?.[entry.rounds.length - 1];
    if (!retryBlocked && !includeAtTarget && last?.status === "blocked_menu_ui") {
      blockedSkip++;
      continue;
    }
    todo.push({
      name: it.name,
      itemId: it.itemId,
      category: it.category || "",
      current,
      target,
      applyPrice: target,
      diff: current - target,
      posId: pos.id,
      posName: pos.name,
      storePrice: base,
      hubNote: pos.hubNote || "",
      rule,
      fromOverride: resolved.fromOverride,
      viaFollower: resolved.viaFollower,
      source: "hub",
    });
  }
  // บน→ล่างตามชื่อ (คิวเดียว 1 worker)
  todo.sort((a, b) => String(a.name).localeCompare(String(b.name), "th"));
  return {
    todo,
    meta: {
      grabRule,
      mainChannel: ctx.mainChannel,
      matched,
      storeOnlySkip,
      atTarget,
      blockedSkip,
      noteSkip,
      noteFilter: noteNeedle,
      remaining: todo.length,
      retryBlocked,
    },
  };
}

/**
 * Map Shopee dishId → POS id + hub target (all matched non-storeOnly items).
 * @returns {Promise<Map<string, { posId: string, target: number, name: string }>>}
 */
export async function mapShopeeScanToPos(scanItems) {
  const ctx = await loadHubChannelContext();
  const { items } = ctx;
  const posIndex = buildPosNameIndexes(items);
  const out = new Map();
  for (const it of scanItems || []) {
    const pos = findPosByScanName(posIndex, it.name);
    if (!pos || pos.storeOnly) continue;
    const { target } = resolveHubItemTarget(pos, "shopee", ctx);
    const key = String(it.dishId || "");
    if (!key) continue;
    out.set(key, { posId: pos.id, target, name: it.name || pos.name });
  }
  return out;
}

/**
 * Build Shopee apply plan from live scan + hub targets (15% step applied by caller).
 * @returns {{ todo: object[], meta: object }}
 */
export async function buildShopeeHubPlan(scanItems, { tracker = { items: {} } } = {}) {
  const ctx = await loadHubChannelContext();
  const { channels, items } = ctx;
  const shopeeRule = channels.shopee || { mode: "offset", value: 0 };
  const posIndex = buildPosNameIndexes(items);

  const todo = [];
  let matched = 0;
  let storeOnlySkip = 0;
  let atTarget = 0;
  let blockedSkip = 0;

  for (const it of scanItems || []) {
    if (/^ลบไม่ได้\s/.test(String(it.name || ""))) continue;
    const pos = findPosByScanName(posIndex, it.name);
    if (!pos) continue;
    matched++;
    if (pos.storeOnly) {
      storeOnlySkip++;
      continue;
    }
    const resolved = resolveHubItemTarget(pos, "shopee", ctx);
    const target = resolved.target;
    const rule = resolved.rule;
    const base = Math.max(0, Number(pos.price) || 0);
    const entry =
      tracker.items?.[it.dishId] || tracker.items?.[String(it.dishId)] || tracker.items?.[it.name];
    const fromTracker = entry?.currentLive;
    const current =
      fromTracker != null && Number.isFinite(Number(fromTracker))
        ? Number(fromTracker)
        : Number(it.listPrice);
    if (!Number.isFinite(current)) continue;
    if (current === target) {
      atTarget++;
      continue;
    }
    todo.push({
      name: it.name,
      dishId: it.dishId || entry?.dishId,
      current,
      target,
      applyPrice: target,
      diff: current - target,
      posId: pos.id,
      posName: pos.name,
      storePrice: base,
      categoryId: pos.categoryId || "",
      categoryName: pos.categoryName || "",
      rule,
      fromOverride: resolved.fromOverride,
      viaFollower: resolved.viaFollower,
      source: "hub",
    });
  }
  todo.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  return {
    todo,
    meta: {
      shopeeRule,
      mainChannel: ctx.mainChannel,
      matched,
      storeOnlySkip,
      atTarget,
      blockedSkip,
      remaining: todo.length,
    },
  };
}

/**
 * Build LINE MAN (Wongnai) apply plan from live scan + hub targets.
 * @returns {{ todo: object[], meta: object }}
 */
export async function buildLinemanHubPlan(scanItems, { tracker = { items: {} }, retryBlocked = false } = {}) {
  const ctx = await loadHubChannelContext();
  const { channels, items } = ctx;
  const linemanRule = channels.lineman || { mode: "offset", value: 0 };
  const posIndex = buildPosNameIndexes(items);

  const todo = [];
  let matched = 0;
  let storeOnlySkip = 0;
  let atTarget = 0;
  let blockedSkip = 0;
  let overrideN = 0;
  let columnN = 0;
  let followerN = 0;

  for (const it of scanItems || []) {
    const pos = findPosByScanName(posIndex, it.name);
    if (!pos) continue;
    matched++;
    if (pos.storeOnly) {
      storeOnlySkip++;
      continue;
    }
    const resolved = resolveHubItemTarget(pos, "lineman", ctx);
    if (resolved.fromOverride) overrideN += 1;
    else if (resolved.viaFollower) followerN += 1;
    else columnN += 1;
    const target = resolved.target;
    const rule = resolved.rule;
    const base = Math.max(0, Number(pos.price) || 0);
    const entry = tracker.items?.[it.id] || tracker.items?.[String(it.id)] || tracker.items?.[it.name];
    const fromTracker = entry?.currentLive;
    const current =
      fromTracker != null && Number.isFinite(Number(fromTracker))
        ? Number(fromTracker)
        : Number(it.listPrice);
    if (!Number.isFinite(current)) continue;
    if (current === target) {
      atTarget++;
      continue;
    }
    const last = entry?.rounds?.[entry.rounds.length - 1];
    if (!retryBlocked && last?.status === "blocked_menu_ui") {
      blockedSkip++;
      continue;
    }
    todo.push({
      name: it.name,
      id: it.id,
      href: it.href || "",
      category: it.category || "",
      current,
      target,
      applyPrice: target,
      diff: current - target,
      posId: pos.id,
      posName: pos.name,
      storePrice: base,
      rule,
      fromOverride: resolved.fromOverride,
      viaFollower: resolved.viaFollower,
      source: "hub",
    });
  }
  todo.sort((a, b) => String(a.name).localeCompare(String(b.name), "th"));
  return {
    todo,
    meta: {
      linemanRule,
      mainChannel: ctx.mainChannel,
      matched,
      storeOnlySkip,
      atTarget,
      blockedSkip,
      remaining: todo.length,
      retryBlocked,
      overrideN,
      columnN,
      followerN,
    },
  };
}
