import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { getDb } from "./firebase";
import type { MenuItem } from "./types";

export async function listMenuItems(): Promise<MenuItem[]> {
  const snap = await getDocs(query(collection(getDb(), "menu"), orderBy("sortOrder", "asc")));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MenuItem, "id">) }));
}

export async function createMenuItem(
  input: Omit<MenuItem, "id" | "updatedAt" | "sortOrder"> & { sortOrder?: number },
): Promise<string> {
  const payload = {
    name: input.name.trim(),
    price: Number(input.price),
    category: input.category.trim() || "ทั่วไป",
    available: input.available,
    sortOrder: input.sortOrder ?? Date.now(),
    updatedAt: Date.now(),
  };
  const ref = await addDoc(collection(getDb(), "menu"), payload);
  return ref.id;
}

export async function updateMenuItem(
  id: string,
  patch: Partial<Omit<MenuItem, "id">>,
): Promise<void> {
  await updateDoc(doc(getDb(), "menu", id), {
    ...patch,
    updatedAt: Date.now(),
  });
}

export async function saveMenuItem(item: MenuItem): Promise<void> {
  const { id, ...rest } = item;
  await setDoc(doc(getDb(), "menu", id), { ...rest, updatedAt: Date.now() });
}

export async function deleteMenuItem(id: string): Promise<void> {
  await deleteDoc(doc(getDb(), "menu", id));
}
