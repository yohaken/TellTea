/**
 * Hub channel price targets from POS store price + menuPriceHub/settings.
 * Used by Grab/Shopee/LINE MAN apply scripts.
 */
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { getSeedDb } from "./pos-firebase-seed.mjs";
import { bestPosForGrab, isStoreOnlyName } from "./name-sync-match.mjs";
import { normName } from "./grab-csv.mjs";

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
  return { channels, itemOverrides, optionOverrides, items };
}

/**
 * Build Grab apply plan rows from live scan + hub targets.
 * @returns {{ todo: object[], meta: object }}
 */
export async function buildGrabHubPlan(
  scanItems,
  { tracker = { items: {} }, retryBlocked = false, noteFilter = "", includeAtTarget = false } = {},
) {
  const { channels, itemOverrides, items } = await loadHubChannelContext();
  const grabRule = channels.grab || { mode: "offset", value: 0 };
  const posByName = new Map();
  for (const it of items) {
    const n = normName(it.name);
    if (n) posByName.set(n, it);
  }
  const noteNeedle = String(noteFilter || "").trim().toLowerCase();

  const todo = [];
  let matched = 0;
  let storeOnlySkip = 0;
  let atTarget = 0;
  let blockedSkip = 0;
  let noteSkip = 0;

  for (const it of scanItems || []) {
    const pos = bestPosForGrab(it.name, items) || posByName.get(normName(it.name));
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
    const override = itemOverrides[pos.id]?.grab;
    const rule = override || grabRule;
    const base = Math.max(0, Number(pos.price) || 0);
    const target = applyChannelRule(base, rule);
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
      source: "hub",
    });
  }
  // บน→ล่างตามชื่อ (คิวเดียว 1 worker)
  todo.sort((a, b) => String(a.name).localeCompare(String(b.name), "th"));
  return {
    todo,
    meta: {
      grabRule,
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
  const { channels, itemOverrides, items } = await loadHubChannelContext();
  const shopeeRule = channels.shopee || { mode: "offset", value: 0 };
  const posByName = new Map();
  for (const it of items) {
    const n = normName(it.name);
    if (n) posByName.set(n, it);
  }
  const out = new Map();
  for (const it of scanItems || []) {
    const pos = bestPosForGrab(it.name, items) || posByName.get(normName(it.name));
    if (!pos || pos.storeOnly) continue;
    const override = itemOverrides[pos.id]?.shopee;
    const rule = override || shopeeRule;
    const base = Math.max(0, Number(pos.price) || 0);
    const target = applyChannelRule(base, rule);
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
  const { channels, itemOverrides, items } = await loadHubChannelContext();
  const shopeeRule = channels.shopee || { mode: "offset", value: 0 };
  const posByName = new Map();
  for (const it of items) {
    const n = normName(it.name);
    if (n) posByName.set(n, it);
  }

  const todo = [];
  let matched = 0;
  let storeOnlySkip = 0;
  let atTarget = 0;
  let blockedSkip = 0;

  for (const it of scanItems || []) {
    const pos = bestPosForGrab(it.name, items) || posByName.get(normName(it.name));
    if (!pos) continue;
    matched++;
    if (pos.storeOnly) {
      storeOnlySkip++;
      continue;
    }
    const override = itemOverrides[pos.id]?.shopee;
    const rule = override || shopeeRule;
    const base = Math.max(0, Number(pos.price) || 0);
    const target = applyChannelRule(base, rule);
    const entry = tracker.items?.[it.dishId] || tracker.items?.[String(it.dishId)] || tracker.items?.[it.name];
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
      source: "hub",
    });
  }
  todo.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  return {
    todo,
    meta: {
      shopeeRule,
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
  const { channels, itemOverrides, items } = await loadHubChannelContext();
  const linemanRule = channels.lineman || { mode: "offset", value: 0 };
  const posByName = new Map();
  for (const it of items) {
    const n = normName(it.name);
    if (n) posByName.set(n, it);
  }

  const todo = [];
  let matched = 0;
  let storeOnlySkip = 0;
  let atTarget = 0;
  let blockedSkip = 0;

  for (const it of scanItems || []) {
    const pos = bestPosForGrab(it.name, items) || posByName.get(normName(it.name));
    if (!pos) continue;
    matched++;
    if (pos.storeOnly) {
      storeOnlySkip++;
      continue;
    }
    const override = itemOverrides[pos.id]?.lineman;
    const rule = override || linemanRule;
    const base = Math.max(0, Number(pos.price) || 0);
    const target = applyChannelRule(base, rule);
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
      source: "hub",
    });
  }
  todo.sort((a, b) => String(a.name).localeCompare(String(b.name), "th"));
  return {
    todo,
    meta: {
      linemanRule,
      matched,
      storeOnlySkip,
      atTarget,
      blockedSkip,
      remaining: todo.length,
      retryBlocked,
    },
  };
}
