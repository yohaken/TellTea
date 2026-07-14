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

/**
 * Optimistic reorder ที่ผู้ใช้เพิ่งทำ — ค้างชั่วคราวจนกว่าโหลด Firebase จะไล่ทัน
 * ไม่ใช่ “ไฟล์เบส” ถาวร: เมื่อไม่มี pending จะยึดลำดับจากโหลดล่าสุดเสมอ
 */
const PENDING_ORDER_MS = 12_000;
let pendingOrderUntil = 0;
let pendingCategories: MenuCategory[] | null = null;
let pendingItems: MenuItem[] | null = null;
let pendingGroups: MenuOptionGroup[] | null = null;

function emit() {
  for (const fn of listeners) fn(snapshot);
}

function sortKeyList(ids: string[]): string {
  return ids.join("|");
}

export function categoryOrderKey(rows: MenuCategory[]): string {
  return sortKeyList([...rows].sort((a, b) => a.sortOrder - b.sortOrder).map((r) => r.id));
}

export function itemOrderKey(rows: MenuItem[]): string {
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

export function groupOrderKey(rows: MenuOptionGroup[]): string {
  return sortKeyList([...rows].sort((a, b) => a.sortOrder - b.sortOrder).map((r) => r.id));
}

function clearPendingOrder() {
  pendingOrderUntil = 0;
  pendingCategories = null;
  pendingItems = null;
  pendingGroups = null;
}

function hasActivePendingOrder(): boolean {
  return pendingOrderUntil > Date.now() && !!pendingCategories;
}

/**
 * ระหว่างรอ Firebase ตามลำดับที่เพิ่งจัด — ทับ sortOrder จาก pending
 * หมดเวลา / ไม่มี pending → คืนลำดับจากโหลดตามเดิม
 */
function applyPendingOrder(
  categories: MenuCategory[],
  items: MenuItem[],
  optionGroups: MenuOptionGroup[],
): { categories: MenuCategory[]; items: MenuItem[]; optionGroups: MenuOptionGroup[] } {
  if (!hasActivePendingOrder()) {
    clearPendingOrder();
    return { categories, items, optionGroups };
  }

  let nextCats = categories;
  let nextItems = items;
  let nextGroups = optionGroups;

  if (pendingCategories) {
    const byId = new Map(categories.map((c) => [c.id, c]));
    nextCats = pendingCategories
      .map((held) => {
        const live = byId.get(held.id);
        return live ? { ...live, sortOrder: held.sortOrder } : null;
      })
      .filter((c): c is MenuCategory => !!c);
    for (const c of categories) {
      if (!nextCats.some((x) => x.id === c.id)) nextCats.push(c);
    }
  }

  if (pendingItems) {
    const byId = new Map(items.map((i) => [i.id, i]));
    nextItems = pendingItems
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

  if (pendingGroups) {
    const byId = new Map(optionGroups.map((g) => [g.id, g]));
    nextGroups = pendingGroups
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

/** ปล่อย pending เมื่อโหลด (ดิบ) ไล่ทันลำดับที่ผู้ใช้จัด — เทียบ incoming ไม่ใช่หลัง apply */
function releasePendingIfRemoteCaughtUp(
  categories: MenuCategory[],
  items: MenuItem[],
  optionGroups: MenuOptionGroup[],
): void {
  if (!hasActivePendingOrder() || !pendingCategories || !pendingItems || !pendingGroups) return;
  if (
    categoryOrderKey(categories) === categoryOrderKey(pendingCategories) &&
    itemOrderKey(items) === itemOrderKey(pendingItems) &&
    groupOrderKey(optionGroups) === groupOrderKey(pendingGroups)
  ) {
    clearPendingOrder();
  }
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
 * Local-first: จัดเรียงในเครื่องทันทีให้หน้าขายเห็นก่อน
 * ค้างเป็น pending สั้นๆ จนโหลด Firebase ไล่ทัน — หลังจากนั้นยึดลำดับจากโหลดล่าสุด
 * ไม่ล็อกลำดับในแคชถาวรที่ทับข้อมูลใหม่
 */
export function publishLocalMenuOrder(input: {
  categories: MenuCategory[];
  items: MenuItem[];
  optionGroups: MenuOptionGroup[];
}): void {
  pendingCategories = input.categories;
  pendingItems = input.items;
  pendingGroups = input.optionGroups;
  pendingOrderUntil = Date.now() + PENDING_ORDER_MS;

  // mirror ชั่วคราวเพื่อ boot รอบถัดไปถ้ายังออฟไลน์ — จะถูกทับด้วยโหลดล่าสุดเมื่อซิงก์สำเร็จ
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
    syncing: true,
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

      // ถ้าโหลดดิบไล่ทัน pending → ปล่อย แล้วใช้ลำดับจากโหลด
      releasePendingIfRemoteCaughtUp(categories, items, optionGroups);

      // มี pending ที่ยังไม่ทัน → จัดเรียงชั่วคราวบนข้อมูลสด
      // ไม่มี pending → ใช้ลำดับจากโหลดล่าสุดเสมอ (ผู้ใช้ไม่ต้องจัดซ้ำ)
      const next = applyPendingOrder(categories, items, optionGroups);

      // Mirror แคชเฉพาะเมื่อ settled (ไม่มี pending) หรือยังถือ pending อยู่
      // เพื่อไม่ให้ Firestore IDB เก่าเขียนทับลำดับที่เพิ่งจัดระหว่างซิงก์
      if (hasActivePendingOrder()) {
        savePosMenuCache(next.categories, next.items, next.optionGroups);
      } else {
        savePosMenuCache(categories, items, optionGroups);
      }

      snapshot = {
        categories: next.categories,
        items: next.items,
        optionGroups: next.optionGroups,
        ready: true,
        fromCache,
        syncing: hasActivePendingOrder() || fromCache,
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
  clearPendingOrder();
  snapshot = { ...EMPTY };
  if (!applyCache()) {
    snapshot = { ...EMPTY, ready: true, syncing: true };
  }
  emit();
  startPosMenuPreload();
}
