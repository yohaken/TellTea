import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getPosDb } from "./pos-firebase";
import { mapFirestoreError } from "./firestore-errors";
import type { MenuCategory, MenuItem } from "./types";

export const MENU_CATEGORIES_COL = "menuCategories";
export const MENU_ITEMS_COL = "menuItems";

function categoriesCol() {
  return collection(getPosDb(), MENU_CATEGORIES_COL);
}

function itemsCol() {
  return collection(getPosDb(), MENU_ITEMS_COL);
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
  return {
    id,
    categoryId: typeof data.categoryId === "string" ? data.categoryId : "",
    name: typeof data.name === "string" ? data.name : "",
    price: typeof data.price === "number" ? data.price : 0,
    sortOrder: typeof data.sortOrder === "number" ? data.sortOrder : 0,
    active: data.active !== false,
    createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
  };
}

export function subscribeMenuCategories(
  onData: (items: MenuCategory[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(categoriesCol(), orderBy("sortOrder", "asc"));
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => mapCategory(d.id, d.data() as Record<string, unknown>)));
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export function subscribeMenuItems(
  onData: (items: MenuItem[]) => void,
  onError?: (err: Error) => void,
  activeOnly = false,
): Unsubscribe {
  const q = activeOnly
    ? query(itemsCol(), where("active", "==", true), orderBy("sortOrder", "asc"))
    : query(itemsCol(), orderBy("sortOrder", "asc"));
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => mapItem(d.id, d.data() as Record<string, unknown>)));
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
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
    });
    return ref.id;
  } catch (err) {
    throw new Error(mapFirestoreError(err, "เพิ่มหมวดเมนู", "pos"));
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
    await updateDoc(doc(getPosDb(), MENU_CATEGORIES_COL, id), next);
  } catch (err) {
    throw new Error(mapFirestoreError(err, "อัปเดตหมวดเมนู", "pos"));
  }
}

export async function addMenuItem(input: {
  categoryId: string;
  name: string;
  price: number;
}): Promise<string> {
  const now = Date.now();
  try {
    const ref = await addDoc(itemsCol(), {
      categoryId: input.categoryId,
      name: input.name.trim(),
      price: Math.max(0, Number(input.price) || 0),
      sortOrder: now,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    return ref.id;
  } catch (err) {
    throw new Error(mapFirestoreError(err, "เพิ่มเมนู", "pos"));
  }
}

/** POS quick 86 — toggle sold-out without changing price/name. */
export async function toggleMenuItemSoldOut(id: string, soldOut: boolean): Promise<void> {
  try {
    await updateDoc(doc(getPosDb(), MENU_ITEMS_COL, id), {
      active: !soldOut,
      updatedAt: Date.now(),
    });
  } catch (err) {
    throw new Error(mapFirestoreError(err, soldOut ? "ปิดเมนูของหมด" : "เปิดเมนูขาย", "pos"));
  }
}

export async function updateMenuItem(
  id: string,
  patch: Partial<Pick<MenuItem, "categoryId" | "name" | "price" | "active">>,
): Promise<void> {
  const next: Record<string, unknown> = { updatedAt: Date.now() };
  if (patch.categoryId != null) next.categoryId = patch.categoryId;
  if (patch.name != null) next.name = patch.name.trim();
  if (patch.price != null) next.price = Math.max(0, Number(patch.price) || 0);
  if (patch.active != null) next.active = patch.active;
  try {
    await updateDoc(doc(getPosDb(), MENU_ITEMS_COL, id), next);
  } catch (err) {
    throw new Error(mapFirestoreError(err, "อัปเดตเมนู", "pos"));
  }
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
