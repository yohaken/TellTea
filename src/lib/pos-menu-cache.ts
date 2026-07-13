import type { MenuCategory, MenuItem, MenuOptionGroup } from "./types";

const KEY = "telltea_pos_menu_v2";

export type PosMenuCachePayload = {
  categories: MenuCategory[];
  items: MenuItem[];
  optionGroups: MenuOptionGroup[];
  savedAt: number;
};

export function loadPosMenuCache(): PosMenuCachePayload | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      const legacy = localStorage.getItem("telltea_pos_menu_v1");
      if (!legacy) return null;
      const old = JSON.parse(legacy) as { categories: MenuCategory[]; items: MenuItem[] };
      return { ...old, optionGroups: [], savedAt: Date.now() };
    }
    const data = JSON.parse(raw) as PosMenuCachePayload;
    if (!Array.isArray(data.items)) return null;
    return {
      categories: Array.isArray(data.categories) ? data.categories : [],
      items: data.items,
      optionGroups: Array.isArray(data.optionGroups) ? data.optionGroups : [],
      savedAt: data.savedAt || 0,
    };
  } catch {
    return null;
  }
}

export function savePosMenuCache(
  categories: MenuCategory[],
  items: MenuItem[],
  optionGroups: MenuOptionGroup[] = [],
): void {
  if (typeof localStorage === "undefined") return;
  try {
    const payload: PosMenuCachePayload = {
      categories,
      items,
      optionGroups,
      savedAt: Date.now(),
    };
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // quota / private mode
  }
}
