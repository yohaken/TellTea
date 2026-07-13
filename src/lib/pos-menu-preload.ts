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

/** แนบรูปเข้า memory หลังเมนูข้อความขึ้นแล้ว — ไม่บล็อก boot */
function scheduleImageHydrate(preferImages?: Record<string, string>) {
  if (typeof window === "undefined") return;
  if (imageHydrateId != null) {
    window.clearTimeout(imageHydrateId);
    imageHydrateId = null;
  }

  const run = () => {
    imageHydrateId = null;
    const images = {
      ...loadPosMenuImages(),
      ...(preferImages || {}),
    };
    if (!Object.keys(images).length) return;
    const merged = mergeMenuItemImages(snapshot.items, images);
    const changed = merged.some((item, i) => item.imageUrl !== snapshot.items[i]?.imageUrl);
    if (!changed) return;
    snapshot = { ...snapshot, items: merged };
    emit();
  };

  // หลังเฟรมแรกของเมนูข้อความ — รูปมาเร็ว (ไม่รอ idle นาน)
  imageHydrateId = window.setTimeout(run, 0);
}

function applyCache(): boolean {
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
      const incoming: Record<string, string> = {};
      for (const item of items) {
        if (item.imageUrl) incoming[item.id] = item.imageUrl;
      }
      if (Object.keys(incoming).length) {
        savePosMenuImages({ ...loadPosMenuImages(), ...incoming });
      }

      // หน่วยความจำ: เก็บรูปไว้โชว์ทันที — ดิสก์แคชยังเบา (savePosMenuCache แยกรูปแล้ว)
      snapshot = {
        categories,
        items,
        optionGroups,
        ready: true,
        fromCache: fromCache && snapshot.fromCache,
        syncing: false,
        error: null,
      };
      emit();
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
    window.clearTimeout(imageHydrateId);
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
