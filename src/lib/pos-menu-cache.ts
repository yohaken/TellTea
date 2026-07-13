import type { MenuCategory, MenuItem } from "./types";

const CACHE_KEY = "telltea_pos_menu_v1";

export type PosMenuCache = {
  categories: MenuCategory[];
  items: MenuItem[];
  savedAt: number;
};

function canUseStorage(): boolean {
  return typeof window !== "undefined";
}

export function loadPosMenuCache(): PosMenuCache | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PosMenuCache;
    if (!Array.isArray(parsed.categories) || !Array.isArray(parsed.items)) return null;
    if (!parsed.items.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function savePosMenuCache(categories: MenuCategory[], items: MenuItem[]): void {
  if (!canUseStorage() || !items.length) return;
  try {
    const payload: PosMenuCache = {
      categories,
      items,
      savedAt: Date.now(),
    };
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // quota / private mode
  }
}

export function clearPosMenuCache(): void {
  if (!canUseStorage()) return;
  window.localStorage.removeItem(CACHE_KEY);
}
