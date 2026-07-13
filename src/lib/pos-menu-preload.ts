import { loadPosMenuCache, savePosMenuCache } from "./pos-menu-cache";
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
/** กัน Firestore snapshot เก่าทับลำดับที่เพิ่งกด ↑↓ ในเครื่อง */
let localOrderHoldUntil = 0;
let localOrderCategories: MenuCategory[] | null = null;
let localOrderItems: MenuItem[] | null = null;
let localOrderGroups: MenuOptionGroup[] | null = null;

function emit() {
  for (const fn of listeners) fn(snapshot);
}

function sortKeyList(ids: string[]): string {
  return ids.join("|");
}

function categoryOrderKey(rows: MenuCategory[]): string {
  return sortKeyList([...rows].sort((a, b) => a.sortOrder - b.sortOrder).map((r) => r.id));
}

function itemOrderKey(rows: MenuItem[]): string {
  return sortKeyList(
    [...rows]
      .sort(
        (a, b) =>
          a.categoryId.localeCompare(b.categoryId) ||
          a.sortOrder - b.sortOrder ||
          a.name.localeCompare(b.name, "th"),
      )
      .map((r) => `${r.categoryId}:${r.id}`),
  );
}

function groupOrderKey(rows: MenuOptionGroup[]): string {
  return sortKeyList([...rows].sort((a, b) => a.sortOrder - b.sortOrder).map((r) => r.id));
}

function applyHeldOrder(
  categories: MenuCategory[],
  items: MenuItem[],
  optionGroups: MenuOptionGroup[],
): { categories: MenuCategory[]; items: MenuItem[]; optionGroups: MenuOptionGroup[] } {
  if (Date.now() >= localOrderHoldUntil) {
    localOrderCategories = null;
    localOrderItems = null;
    localOrderGroups = null;
    return { categories, items, optionGroups };
  }

  let nextCats = categories;
  let nextItems = items;
  let nextGroups = optionGroups;

  if (localOrderCategories) {
    const byId = new Map(categories.map((c) => [c.id, c]));
    nextCats = localOrderCategories
      .map((held) => {
        const live = byId.get(held.id);
        return live ? { ...live, sortOrder: held.sortOrder } : null;
      })
      .filter((c): c is MenuCategory => !!c);
    for (const c of categories) {
      if (!nextCats.some((x) => x.id === c.id)) nextCats.push(c);
    }
  }

  if (localOrderItems) {
    const byId = new Map(items.map((i) => [i.id, i]));
    nextItems = localOrderItems
      .map((held) => {
        const live = byId.get(held.id);
        return live
          ? { ...live, sortOrder: held.sortOrder, categoryId: held.categoryId }
          : null;
      })
      .filter((i): i is MenuItem => !!i);
    for (const i of items) {
      if (!nextItems.some((x) => x.id === i.id)) nextItems.push(i);
    }
  }

  if (localOrderGroups) {
    const byId = new Map(optionGroups.map((g) => [g.id, g]));
    nextGroups = localOrderGroups
      .map((held) => {
        const live = byId.get(held.id);
        return live ? { ...live, sortOrder: held.sortOrder } : null;
      })
      .filter((g): g is MenuOptionGroup => !!g);
    for (const g of optionGroups) {
      if (!nextGroups.some((x) => x.id === g.id)) nextGroups.push(g);
    }
  }

  return { categories: nextCats, items: nextItems, optionGroups: nextGroups };
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

/**
 * บันทึกลำดับเมนูในเครื่องทันที → หน้าขายเห็นทันที
 * Firebase ยังอัปเดตเงียบๆ จาก caller (`void reorder…`)
 */
export function publishLocalMenuOrder(input: {
  categories: MenuCategory[];
  items: MenuItem[];
  optionGroups: MenuOptionGroup[];
}): void {
  localOrderCategories = input.categories;
  localOrderItems = input.items;
  localOrderGroups = input.optionGroups;
  localOrderHoldUntil = Date.now() + 12_000;

  savePosMenuCache(input.categories, input.items, input.optionGroups);

  const images = loadPosMenuImages();
  const withImages = Object.keys(images).length
    ? mergeMenuItemImages(input.items, images)
    : input.items;

  snapshot = {
    categories: input.categories,
    items: withImages,
    optionGroups: input.optionGroups,
    ready: true,
    fromCache: true,
    syncing: false,
    error: null,
  };
  emit();
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

      const held = applyHeldOrder(categories, items, optionGroups);

      // เมื่อ Firestore ไล่ทันลำดับในเครื่องแล้ว — ปล่อย hold
      if (
        localOrderHoldUntil > Date.now() &&
        localOrderCategories &&
        localOrderItems &&
        localOrderGroups &&
        categoryOrderKey(held.categories) === categoryOrderKey(localOrderCategories) &&
        itemOrderKey(held.items) === itemOrderKey(localOrderItems) &&
        groupOrderKey(held.optionGroups) === groupOrderKey(localOrderGroups)
      ) {
        localOrderHoldUntil = 0;
        localOrderCategories = null;
        localOrderItems = null;
        localOrderGroups = null;
      }

      // หน่วยความจำ: เก็บรูปไว้โชว์ทันที — ดิสก์แคชยังเบา (savePosMenuCache แยกรูปแล้ว)
      snapshot = {
        categories: held.categories,
        items: held.items,
        optionGroups: held.optionGroups,
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
  localOrderHoldUntil = 0;
  localOrderCategories = null;
  localOrderItems = null;
  localOrderGroups = null;
  snapshot = { ...EMPTY };
  if (!applyCache()) {
    snapshot = { ...EMPTY, ready: true, syncing: true };
  }
  emit();
  startPosMenuPreload();
}
