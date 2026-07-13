import type { MenuItem } from "./types";

const IMG_KEY = "telltea_pos_menu_images_v1";

/** แผนที่ menuItemId → imageUrl (data URL หรือ remote) — แยกจากแคชเมนูเบา */
export function loadPosMenuImages(): Record<string, string> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(IMG_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [id, url] of Object.entries(parsed)) {
      if (typeof url === "string" && url.length > 8) out[id] = url;
    }
    return out;
  } catch {
    return {};
  }
}

export function savePosMenuImages(map: Record<string, string>): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(IMG_KEY, JSON.stringify(map));
  } catch {
    /* quota — เมนูข้อความยังขายได้ */
  }
}

export function stripItemImages(items: MenuItem[]): MenuItem[] {
  return items.map((item) => {
    if (!item.imageUrl) return item;
    return { ...item, imageUrl: undefined };
  });
}

/** ดึงรูปออกจากรายการ → เก็บแยก + คืนรายการเบา */
export function splitMenuItemImages(items: MenuItem[]): {
  lightItems: MenuItem[];
  images: Record<string, string>;
} {
  const images: Record<string, string> = {};
  const lightItems = items.map((item) => {
    if (item.imageUrl) images[item.id] = item.imageUrl;
    if (!item.imageUrl) return item;
    return { ...item, imageUrl: undefined };
  });
  return { lightItems, images };
}

export function mergeMenuItemImages(
  items: MenuItem[],
  images: Record<string, string>,
): MenuItem[] {
  if (!Object.keys(images).length) return items;
  return items.map((item) => {
    const url = images[item.id];
    if (!url || item.imageUrl === url) return item;
    return { ...item, imageUrl: url };
  });
}
