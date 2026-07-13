import type { MenuCategory, MenuItem, MenuOptionGroup } from "./types";
import {
  loadPosMenuImages,
  mergeMenuItemImages,
  savePosMenuImages,
  splitMenuItemImages,
  stripItemImages,
} from "./pos-menu-image-cache";

const KEY = "telltea_pos_menu_v2";

export type PosMenuCachePayload = {
  categories: MenuCategory[];
  items: MenuItem[];
  optionGroups: MenuOptionGroup[];
  savedAt: number;
};

/** อ่านแคชเมนูเบา (ไม่มีรูปฝัง) — ความเร็ว boot */
export function loadPosMenuCache(options?: { withImages?: boolean }): PosMenuCachePayload | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      const legacy = localStorage.getItem("telltea_pos_menu_v1");
      if (!legacy) return null;
      const old = JSON.parse(legacy) as { categories: MenuCategory[]; items: MenuItem[] };
      const { lightItems, images } = splitMenuItemImages(old.items || []);
      if (Object.keys(images).length) savePosMenuImages({ ...loadPosMenuImages(), ...images });
      return {
        categories: old.categories || [],
        items: options?.withImages ? mergeMenuItemImages(lightItems, loadPosMenuImages()) : lightItems,
        optionGroups: [],
        savedAt: Date.now(),
      };
    }
    const data = JSON.parse(raw) as PosMenuCachePayload;
    if (!Array.isArray(data.items)) return null;

    // migrate: ถ้ารูปยังฝังในรายการ — แยกเก็บ
    const { lightItems, images: embedded } = splitMenuItemImages(data.items);
    if (Object.keys(embedded).length) {
      savePosMenuImages({ ...loadPosMenuImages(), ...embedded });
      try {
        localStorage.setItem(
          KEY,
          JSON.stringify({
            categories: data.categories,
            items: lightItems,
            optionGroups: data.optionGroups,
            savedAt: data.savedAt || Date.now(),
          } satisfies PosMenuCachePayload),
        );
      } catch {
        /* ignore */
      }
    }

    const items = options?.withImages
      ? mergeMenuItemImages(lightItems, loadPosMenuImages())
      : lightItems;

    return {
      categories: Array.isArray(data.categories) ? data.categories : [],
      items,
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
    const { lightItems, images } = splitMenuItemImages(items);
    if (Object.keys(images).length) {
      savePosMenuImages({ ...loadPosMenuImages(), ...images });
    }
    const payload: PosMenuCachePayload = {
      categories,
      items: stripItemImages(lightItems),
      optionGroups,
      savedAt: Date.now(),
    };
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // quota / private mode
  }
}
