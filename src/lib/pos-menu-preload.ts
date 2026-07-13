import { loadPosMenuCache } from "./pos-menu-cache";
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

function emit() {
  for (const fn of listeners) fn(snapshot);
}

function applyCache(): boolean {
  const cached = loadPosMenuCache();
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
    // ไม่บล็อก UI — พร้อมขาย (เมนูว่าง) แล้วค่อยโหลดเงียบ
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
        snapshot = { ...snapshot, ready: true, syncing: snapshot.items.length === 0 ? false : snapshot.syncing };
        emit();
      }
    }, 4_000);
  }

  unsubscribe = subscribePosMenuBundle(
    ({ categories, items, optionGroups, fromCache }) => {
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
  seedStarted = false;
  snapshot = { ...EMPTY };
  if (!applyCache()) {
    snapshot = { ...EMPTY, ready: true, syncing: true };
  }
  emit();
  startPosMenuPreload();
}
