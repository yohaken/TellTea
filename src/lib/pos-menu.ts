import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  getDocsFromCache,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getMenuDb, menuErrorHint, type MenuPriceChannel } from "./pos-menu-db";
import { mapFirestoreError } from "./firestore-errors";
import { listMenuOptionGroups, subscribeMenuOptionGroups } from "./pos-menu-options";
import type { MenuCategory, MenuItem, MenuOptionGroup } from "./types";

export const MENU_CATEGORIES_COL = "menuCategories";
export const MENU_ITEMS_COL = "menuItems";

export type { MenuPriceChannel };

/** ราคาเมนูตามช่องทาง — ไม่มี deliveryPrice → ใช้ price */
export function resolveMenuItemPrice(
  item: Pick<MenuItem, "price" | "deliveryPrice">,
  channel: MenuPriceChannel = "store",
): number {
  if (channel === "delivery" && typeof item.deliveryPrice === "number") {
    return Math.max(0, item.deliveryPrice);
  }
  return Math.max(0, item.price);
}

function categoriesCol() {
  return collection(getMenuDb(), MENU_CATEGORIES_COL);
}

function itemsCol() {
  return collection(getMenuDb(), MENU_ITEMS_COL);
}

function mapCategory(id: string, data: Record<string, unknown>): MenuCategory {
  return {
    id,
    name: typeof data.name === "string" ? data.name : "",
    sortOrder: typeof data.sortOrder === "number" ? data.sortOrder : 0,
    active: data.active !== false,
    createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
  };
}

function mapItem(id: string, data: Record<string, unknown>): MenuItem {
  const optionGroupIds = Array.isArray(data.optionGroupIds)
    ? data.optionGroupIds.filter((x): x is string => typeof x === "string")
    : undefined;
  return {
    id,
    categoryId: typeof data.categoryId === "string" ? data.categoryId : "",
    name: typeof data.name === "string" ? data.name : "",
    nameEn: typeof data.nameEn === "string" ? data.nameEn : undefined,
    price: typeof data.price === "number" ? data.price : 0,
    ...(typeof data.deliveryPrice === "number" ? { deliveryPrice: data.deliveryPrice } : {}),
    sortOrder: typeof data.sortOrder === "number" ? data.sortOrder : 0,
    active: data.active !== false,
    visibleOnPos: data.visibleOnPos !== false,
    recommended: data.recommended === true,
    imageUrl: typeof data.imageUrl === "string" && data.imageUrl ? data.imageUrl : undefined,
    description: typeof data.description === "string" ? data.description : undefined,
    optionGroupIds: optionGroupIds?.length ? optionGroupIds : undefined,
    ...(typeof data.code === "string" && data.code.trim() ? { code: data.code.trim() } : {}),
    createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
  };
}

export function subscribeMenuCategories(
  onData: (items: MenuCategory[], fromCache?: boolean) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(categoriesCol(), orderBy("sortOrder", "asc"));
  return onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snap) => {
      onData(
        snap.docs.map((d) => mapCategory(d.id, d.data() as Record<string, unknown>)),
        snap.metadata.fromCache,
      );
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export function subscribeMenuItems(
  onData: (items: MenuItem[], fromCache?: boolean) => void,
  onError?: (err: Error) => void,
  activeOnly = false,
): Unsubscribe {
  const q = activeOnly
    ? query(itemsCol(), where("active", "==", true), orderBy("sortOrder", "asc"))
    : query(itemsCol(), orderBy("sortOrder", "asc"));
  return onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snap) => {
      onData(
        snap.docs.map((d) => mapItem(d.id, d.data() as Record<string, unknown>)),
        snap.metadata.fromCache,
      );
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export type PosMenuBundle = {
  categories: MenuCategory[];
  items: MenuItem[];
  optionGroups: MenuOptionGroup[];
  fromCache: boolean;
};

/**
 * Cache-first live menu — categories, items, option groups.
 * ไม่เขียน localStorage ที่นี่: ให้ pos-menu-preload เป็นคน mirror แคช
 * ตามนโยบาย local-first → ยึดลำดับจากโหลดล่าสุดเมื่อข้อมูลพร้อม
 */
export function subscribePosMenuBundle(
  onData: (data: PosMenuBundle) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  let categories: MenuCategory[] = [];
  let items: MenuItem[] = [];
  let optionGroups: MenuOptionGroup[] = [];
  let catsFromCache = true;
  let itemsFromCache = true;
  let groupsFromCache = true;

  function publish() {
    if (!categories.length && !items.length && !optionGroups.length) return;
    onData({
      categories,
      items,
      optionGroups,
      fromCache: catsFromCache || itemsFromCache || groupsFromCache,
    });
  }

  void (async () => {
    try {
      const [catSnap, itemSnap] = await Promise.all([
        getDocsFromCache(query(categoriesCol(), orderBy("sortOrder", "asc"))),
        getDocsFromCache(query(itemsCol(), orderBy("sortOrder", "asc"))),
      ]);
      categories = catSnap.docs.map((d) => mapCategory(d.id, d.data() as Record<string, unknown>));
      items = itemSnap.docs.map((d) => mapItem(d.id, d.data() as Record<string, unknown>));
      catsFromCache = true;
      itemsFromCache = true;
      if (items.length) publish();
    } catch {
      // wait for onSnapshot
    }
  })();

  const unsubCat = subscribeMenuCategories(
    (list, fromCache) => {
      categories = list;
      catsFromCache = fromCache !== false;
      publish();
    },
    onError,
  );
  const unsubItems = subscribeMenuItems((list, fromCache) => {
    items = list;
    itemsFromCache = fromCache !== false;
    publish();
  }, onError);
  const unsubGroups = subscribeMenuOptionGroups((list, fromCache) => {
    optionGroups = list;
    groupsFromCache = fromCache !== false;
    publish();
  }, onError);

  return () => {
    unsubCat();
    unsubItems();
    unsubGroups();
  };
}

export async function listMenuCategories(): Promise<MenuCategory[]> {
  const snap = await getDocs(query(categoriesCol(), orderBy("sortOrder", "asc")));
  return snap.docs.map((d) => mapCategory(d.id, d.data() as Record<string, unknown>));
}

export async function listMenuItems(): Promise<MenuItem[]> {
  const snap = await getDocs(query(itemsCol(), orderBy("sortOrder", "asc")));
  return snap.docs.map((d) => mapItem(d.id, d.data() as Record<string, unknown>));
}

export async function addMenuCategory(name: string): Promise<string> {
  const now = Date.now();
  try {
    const ref = await addDoc(categoriesCol(), {
      name: name.trim(),
      sortOrder: now,
      active: true,
      createdAt: now,
      updatedAt: now,
      source: "manual",
    });
    return ref.id;
  } catch (err) {
    throw new Error(mapFirestoreError(err, "เพิ่มหมวดเมนู", menuErrorHint()));
  }
}

export async function updateMenuCategory(
  id: string,
  patch: Partial<Pick<MenuCategory, "name" | "active" | "sortOrder">>,
): Promise<void> {
  const next: Record<string, unknown> = { updatedAt: Date.now() };
  if (patch.name != null) next.name = patch.name.trim();
  if (patch.active != null) next.active = patch.active;
  if (patch.sortOrder != null) next.sortOrder = patch.sortOrder;
  try {
    await updateDoc(doc(getMenuDb(), MENU_CATEGORIES_COL, id), next);
  } catch (err) {
    throw new Error(mapFirestoreError(err, "อัปเดตหมวดเมนู", menuErrorHint()));
  }
}

export async function deleteMenuCategory(id: string): Promise<void> {
  try {
    await deleteDoc(doc(getMenuDb(), MENU_CATEGORIES_COL, id));
  } catch (err) {
    throw new Error(mapFirestoreError(err, "ลบหมวดเมนู", menuErrorHint()));
  }
}

export async function archiveMenuCategory(id: string): Promise<void> {
  await updateMenuCategory(id, { active: false });
}

export async function restoreMenuCategory(id: string): Promise<void> {
  await updateMenuCategory(id, { active: true });
}

export async function reorderMenuCategories(ids: string[]): Promise<void> {
  await Promise.all(ids.map((id, i) => updateMenuCategory(id, { sortOrder: (i + 1) * 1000 })));
}

export async function reorderMenuItemsInCategory(categoryId: string, ids: string[]): Promise<void> {
  await Promise.all(ids.map((id, i) => updateMenuItem(id, { sortOrder: (i + 1) * 1000, categoryId })));
}

export async function addMenuItem(input: {
  categoryId: string;
  name: string;
  price: number;
  deliveryPrice?: number;
}): Promise<string> {
  const now = Date.now();
  try {
    const row: Record<string, unknown> = {
      categoryId: input.categoryId,
      name: input.name.trim(),
      price: Math.max(0, Number(input.price) || 0),
      sortOrder: now,
      active: true,
      visibleOnPos: true,
      recommended: false,
      source: "manual",
      createdAt: now,
      updatedAt: now,
    };
    if (typeof input.deliveryPrice === "number") {
      row.deliveryPrice = Math.max(0, input.deliveryPrice);
    }
    const ref = await addDoc(itemsCol(), row);
    return ref.id;
  } catch (err) {
    throw new Error(mapFirestoreError(err, "เพิ่มเมนู", menuErrorHint()));
  }
}

export async function toggleMenuItemSoldOut(id: string, soldOut: boolean): Promise<void> {
  try {
    await updateDoc(doc(getMenuDb(), MENU_ITEMS_COL, id), {
      active: !soldOut,
      updatedAt: Date.now(),
    });
  } catch (err) {
    throw new Error(mapFirestoreError(err, soldOut ? "ปิดเมนูของหมด" : "เปิดเมนูขาย", menuErrorHint()));
  }
}

export type MenuItemPatch = Partial<
  Omit<
    Pick<
      MenuItem,
      | "categoryId"
      | "name"
      | "nameEn"
      | "price"
      | "active"
      | "visibleOnPos"
      | "recommended"
      | "imageUrl"
      | "description"
      | "optionGroupIds"
      | "sortOrder"
      | "code"
    >,
    never
  >
> & {
  /** null = ลบฟิลด์เดลิเวอรี่ (ใช้ราคาหน้าร้าน) */
  deliveryPrice?: number | null;
  /** null / ว่าง = ลบรหัสเมนู */
  code?: string | null;
};

export async function updateMenuItem(id: string, patch: MenuItemPatch): Promise<void> {
  const next: Record<string, unknown> = { updatedAt: Date.now() };
  if (patch.categoryId != null) next.categoryId = patch.categoryId;
  if (patch.name != null) next.name = patch.name.trim();
  if (patch.nameEn != null) next.nameEn = patch.nameEn.trim();
  if (patch.price != null) next.price = Math.max(0, Number(patch.price) || 0);
  if (patch.deliveryPrice !== undefined) {
    next.deliveryPrice =
      patch.deliveryPrice == null
        ? deleteField()
        : Math.max(0, Number(patch.deliveryPrice) || 0);
  }
  if (patch.active != null) next.active = patch.active;
  if (patch.visibleOnPos != null) next.visibleOnPos = patch.visibleOnPos;
  if (patch.recommended != null) next.recommended = patch.recommended;
  if (patch.imageUrl != null) next.imageUrl = patch.imageUrl.trim();
  if (patch.description != null) next.description = patch.description.trim();
  if (patch.optionGroupIds != null) next.optionGroupIds = patch.optionGroupIds;
  if (patch.sortOrder != null) next.sortOrder = patch.sortOrder;
  if (patch.code !== undefined) {
    next.code = patch.code == null || !String(patch.code).trim() ? deleteField() : String(patch.code).trim();
  }
  try {
    await updateDoc(doc(getMenuDb(), MENU_ITEMS_COL, id), next);
  } catch (err) {
    throw new Error(mapFirestoreError(err, "อัปเดตเมนู", menuErrorHint()));
  }
}

export async function deleteMenuItem(id: string): Promise<void> {
  try {
    await deleteDoc(doc(getMenuDb(), MENU_ITEMS_COL, id));
  } catch (err) {
    throw new Error(mapFirestoreError(err, "ลบเมนู", menuErrorHint()));
  }
}

/** ซ่อนจากหน้าขาย — คง doc ไว้ (กู้คืนได้) */
export async function archiveMenuItem(id: string): Promise<void> {
  await updateMenuItem(id, { active: false, visibleOnPos: false });
}

export async function restoreMenuItem(id: string): Promise<void> {
  await updateMenuItem(id, { active: true, visibleOnPos: true });
}

/** สำเนาเมนู — ชื่อ + (สำเนา) · คงราคา/ตัวเลือก/รูป */
export async function duplicateMenuItem(item: MenuItem): Promise<string> {
  const id = await addMenuItem({
    categoryId: item.categoryId,
    name: `${item.name.trim()} (สำเนา)`,
    price: item.price,
    ...(typeof item.deliveryPrice === "number" ? { deliveryPrice: item.deliveryPrice } : {}),
  });
  await updateMenuItem(id, {
    nameEn: item.nameEn,
    description: item.description,
    imageUrl: item.imageUrl || "",
    recommended: item.recommended === true,
    visibleOnPos: item.visibleOnPos !== false,
    active: item.active !== false,
    optionGroupIds: item.optionGroupIds ? [...item.optionGroupIds] : [],
    ...(typeof item.deliveryPrice === "number"
      ? { deliveryPrice: item.deliveryPrice }
      : { deliveryPrice: null }),
  });
  return id;
}

const DEFAULT_CATEGORIES = ["ชา", "กาแฟ", "อื่นๆ"] as const;

const DEFAULT_ITEMS: { category: string; name: string; price: number }[] = [
  { category: "ชา", name: "ชาเขียว", price: 45 },
  { category: "ชา", name: "ชานม", price: 50 },
  { category: "ชา", name: "ชาไทย", price: 45 },
  { category: "กาแฟ", name: "ลาเต้", price: 55 },
  { category: "กาแฟ", name: "อเมริกาโน่", price: 50 },
  { category: "อื่นๆ", name: "น้ำเปล่า", price: 15 },
];

export async function seedPosMenuIfEmpty(): Promise<{ seeded: boolean }> {
  const existing = await listMenuItems();
  if (existing.length > 0) return { seeded: false };

  const cats = await listMenuCategories();
  const catByName = new Map(cats.map((c) => [c.name, c.id]));
  for (const name of DEFAULT_CATEGORIES) {
    if (!catByName.has(name)) {
      const id = await addMenuCategory(name);
      catByName.set(name, id);
    }
  }

  for (const row of DEFAULT_ITEMS) {
    const categoryId = catByName.get(row.category);
    if (!categoryId) continue;
    await addMenuItem({ categoryId, name: row.name, price: row.price });
  }

  return { seeded: true };
}

export function posCreatedBy(deviceId: string): string {
  return `pos:${deviceId}`;
}

export async function loadFullPosMenu(): Promise<PosMenuBundle> {
  const [categories, items, optionGroups] = await Promise.all([
    listMenuCategories(),
    listMenuItems(),
    listMenuOptionGroups(),
  ]);
  return { categories, items, optionGroups, fromCache: false };
}
