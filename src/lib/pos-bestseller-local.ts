/**
 * Local-first bestseller qty counters (web POS).
 * Cloud rank (meta/posMenuRank) is source of truth when online;
 * these buckets keep offline / until next recompute.
 */
import type { PosSaleLine } from "./types";

const KEY = "telltea-pos-bestseller-local";
const DAY_MS = 86_400_000;
const KEEP_DAYS = 14;

type DayBucket = Record<string, number>; // menuItemId -> qty
type Store = {
  days: Record<string, DayBucket>; // yyyy-mm-dd -> buckets
  categoryByItem: Record<string, string>;
};

function dayKey(ms = Date.now()): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function readStore(): Store {
  if (typeof localStorage === "undefined") return { days: {}, categoryByItem: {} };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { days: {}, categoryByItem: {} };
    const parsed = JSON.parse(raw) as Store;
    return {
      days: parsed?.days && typeof parsed.days === "object" ? parsed.days : {},
      categoryByItem:
        parsed?.categoryByItem && typeof parsed.categoryByItem === "object"
          ? parsed.categoryByItem
          : {},
    };
  } catch {
    return { days: {}, categoryByItem: {} };
  }
}

function writeStore(store: Store) {
  if (typeof localStorage === "undefined") return;
  try {
    // prune old days
    const cutoff = Date.now() - KEEP_DAYS * DAY_MS;
    const nextDays: Record<string, DayBucket> = {};
    for (const [k, v] of Object.entries(store.days)) {
      const t = Date.parse(k + "T12:00:00");
      if (Number.isFinite(t) && t >= cutoff) nextDays[k] = v;
    }
    localStorage.setItem(
      KEY,
      JSON.stringify({ days: nextDays, categoryByItem: store.categoryByItem }),
    );
  } catch {
    /* quota */
  }
}

function applyDelta(
  lines: { menuItemId?: string; qty?: number; categoryId?: string; name?: string }[],
  sign: 1 | -1,
  categoryIdByItem?: Record<string, string>,
) {
  if (!lines?.length) return;
  const store = readStore();
  const key = dayKey();
  const bucket = { ...(store.days[key] || {}) };
  for (const line of lines) {
    const id = (line.menuItemId || "").trim();
    if (!id) continue;
    const qty = Math.max(0, Number(line.qty) || 0);
    if (!qty) continue;
    const next = Math.max(0, (bucket[id] || 0) + sign * qty);
    if (next === 0) delete bucket[id];
    else bucket[id] = next;
    const cat =
      (line.categoryId || "").trim() ||
      categoryIdByItem?.[id] ||
      store.categoryByItem[id] ||
      "";
    if (cat) store.categoryByItem[id] = cat;
  }
  store.days[key] = bucket;
  writeStore(store);
}

export function recordBestsellerSaleLines(
  lines: PosSaleLine[],
  categoryIdByItem?: Record<string, string>,
) {
  applyDelta(lines, 1, categoryIdByItem);
}

export function reverseBestsellerSaleLines(
  lines: { menuItemId?: string; qty?: number; categoryId?: string }[],
) {
  applyDelta(lines, -1);
}

/** Aggregate local qty for last N days — offline fallback rank input. */
export function localBestsellerQtyMap(windowDays = 7): {
  qtyByItem: Record<string, number>;
  categoryByItem: Record<string, string>;
} {
  const store = readStore();
  const cutoff = Date.now() - Math.max(1, windowDays) * DAY_MS;
  const qtyByItem: Record<string, number> = {};
  for (const [k, bucket] of Object.entries(store.days)) {
    const t = Date.parse(k + "T12:00:00");
    if (!Number.isFinite(t) || t < cutoff) continue;
    for (const [id, qty] of Object.entries(bucket)) {
      qtyByItem[id] = (qtyByItem[id] || 0) + (Number(qty) || 0);
    }
  }
  return { qtyByItem, categoryByItem: { ...store.categoryByItem } };
}
