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
    snapshot = { ...EMPTY, syncing: true };
    emit();
  }

  if (!seedStarted) {
    seedStarted = true;
    void seedPosMenuIfEmpty().catch(() => {});
  }

  if (timeoutId == null && typeof window !== "undefined") {
    timeoutId = window.setTimeout(() => {
      if (!snapshot.ready && snapshot.items.length > 0) {
        snapshot = { ...snapshot, ready: true };
        emit();
      }
    }, 8_000);
  }

  unsubscribe = subscribePosMenuBundle(
    ({ categories, items, optionGroups, fromCache }) => {
      const hasMenu = items.length > 0;
      snapshot = {
        categories,
        items,
        optionGroups,
        ready: hasMenu || snapshot.ready,
        fromCache: fromCache && snapshot.fromCache,
        syncing: false,
        error: null,
      };
      emit();
    },
    (err) => {
      if (snapshot.items.length) {
        snapshot = { ...snapshot, syncing: false, error: err.message, ready: true };
      } else {
        snapshot = { ...snapshot, syncing: false, error: err.message, ready: false };
      }
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
    snapshot = { ...EMPTY, syncing: true };
  }
  emit();
  startPosMenuPreload();
}
