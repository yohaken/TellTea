import { loadPosMenuCache } from "./pos-menu-cache";
import { loadPosMenuImages, mergeMenuItemImages, savePosMenuImages } from "./pos-menu-image-cache";
import { seedPosMenuIfEmpty, subscribePosMenuBundle } from "./pos-menu";
import type { MenuCategory, MenuItem, MenuOptionGroup } from "./types";

export type PosMenuSnapshot = {
  categories: MenuCategory[];
  items: MenuItem[];
  optionGroups: MenuOptionGroup[];
  ready: boolean;
  fromCache: boolean;
  syncing: boolean;
  error: string | null;
};

const EMPTY: PosMenuSnapshot = {
  categories: [],
  items: [],
  optionGroups: [],
  ready: false,
  fromCache: false,
  syncing: false,
  error: null,
};

const listeners = new Set<(snap: PosMenuSnapshot) => void>();
let snapshot: PosMenuSnapshot = { ...EMPTY };
let unsubscribe: (() => void) | null = null;
let seedStarted = false;
let timeoutId: number | null = null;
let imageHydrateId: number | null = null;

function emit() {
  for (const fn of listeners) fn(snapshot);
}

function scheduleImageHydrate() {
  if (typeof window === "undefined") return;
  if (imageHydrateId != null) {
    if (typeof cancelIdleCallback === "function") cancelIdleCallback(imageHydrateId);
    else window.clearTimeout(imageHydrateId);
    imageHydrateId = null;
  }

  const run = () => {
    imageHydrateId = null;
    const images = loadPosMenuImages();
    if (!Object.keys(images).length) return;
    const merged = mergeMenuItemImages(snapshot.items, images);
    const changed = merged.some((item, i) => item.imageUrl !== snapshot.items[i]?.imageUrl);
    if (!changed) return;
    snapshot = { ...snapshot, items: merged };
    emit();
  };

  if (typeof requestIdleCallback === "function") {
    imageHydrateId = requestIdleCallback(run, { timeout: 2000 });
  } else {
    imageHydrateId = window.setTimeout(run, 120);
  }
}

function applyCache(): boolean {
  // เบา: ไม่ merge รูปตอน boot — รูปตามทีหลัง
  const cached = loadPosMenuCache({ withImages: false });
  if (!cached?.items.length) return false;
  snapshot = {
    categories: cached.categories,
    items: cached.items,
    optionGroups: cached.optionGroups,
    ready: true,
    fromCache: true,
    syncing: true,
    error: null,
  };
  emit();
  scheduleImageHydrate();
  return true;
}

export function getPosMenuSnapshot(): PosMenuSnapshot {
  return snapshot;
}

export function subscribePosMenuPreload(listener: (snap: PosMenuSnapshot) => void): () => void {
  listeners.add(listener);
  listener(snapshot);
  return () => listeners.delete(listener);
}

export function startPosMenuPreload(): void {
  if (unsubscribe) return;

  if (!applyCache()) {
    snapshot = { ...EMPTY, ready: true, syncing: true };
    emit();
  }

  if (!seedStarted) {
    seedStarted = true;
    void seedPosMenuIfEmpty().catch(() => {});
  }

  if (timeoutId == null && typeof window !== "undefined") {
    timeoutId = window.setTimeout(() => {
      if (snapshot.syncing) {
        snapshot = {
          ...snapshot,
          ready: true,
          syncing: snapshot.items.length === 0 ? false : snapshot.syncing,
        };
        emit();
      }
    }, 4_000);
  }

  unsubscribe = subscribePosMenuBundle(
    ({ categories, items, optionGroups, fromCache }) => {
      // จาก Firestore/cache — เก็บเมนูเบาทันที แล้วค่อย hydrate รูป
      const lightItems = items.map((item) =>
        item.imageUrl ? { ...item, imageUrl: undefined } : item,
      );
      // เก็บรูปที่มาพร้อม bundle ลง image cache
      const incoming: Record<string, string> = {};
      for (const item of items) {
        if (item.imageUrl) incoming[item.id] = item.imageUrl;
      }
      if (Object.keys(incoming).length) {
        savePosMenuImages({ ...loadPosMenuImages(), ...incoming });
      }

      snapshot = {
        categories,
        items: lightItems,
        optionGroups,
        ready: true,
        fromCache: fromCache && snapshot.fromCache,
        syncing: false,
        error: null,
      };
      emit();
      scheduleImageHydrate();
    },
    (err) => {
      snapshot = {
        ...snapshot,
        syncing: false,
        error: err.message,
        ready: true,
      };
      emit();
    },
  );
}

export function retryPosMenuPreload(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  if (timeoutId != null) {
    window.clearTimeout(timeoutId);
    timeoutId = null;
  }
  if (imageHydrateId != null) {
    if (typeof cancelIdleCallback === "function") cancelIdleCallback(imageHydrateId);
    else window.clearTimeout(imageHydrateId);
    imageHydrateId = null;
  }
  seedStarted = false;
  snapshot = { ...EMPTY };
  if (!applyCache()) {
    snapshot = { ...EMPTY, ready: true, syncing: true };
  }
  emit();
  startPosMenuPreload();
}
