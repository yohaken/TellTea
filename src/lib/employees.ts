import {
  addDoc,
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { getDb } from "./firebase";

/** Shared shop employee roster — one place, used by production and future modules. */
export type Employee = {
  id: string;
  name: string;
  active: boolean;
  createdAt: number;
  updatedAt: number;
};

function employeesCol() {
  return collection(getDb(), "employees");
}

export async function listEmployees(): Promise<Employee[]> {
  const snap = await getDocs(query(employeesCol(), orderBy("name", "asc")));
  return snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<Employee, "id">),
  }));
}

export async function listActiveEmployees(): Promise<Employee[]> {
  return (await listEmployees()).filter((e) => e.active);
}

export async function addEmployee(name: string): Promise<string> {
  const n = name.trim();
  if (!n) throw new Error("ต้องใส่ชื่อพนักงาน");
  const now = Date.now();
  const ref = await addDoc(employeesCol(), {
    name: n,
    active: true,
    createdAt: now,
    updatedAt: now,
  });
  return ref.id;
}

/** Create/overwrite with a fixed id (migration / import). */
export async function upsertEmployeeWithId(
  id: string,
  data: { name: string; active?: boolean; createdAt?: number },
): Promise<void> {
  const n = data.name.trim();
  if (!n) throw new Error("ต้องใส่ชื่อพนักงาน");
  const now = Date.now();
  await setDoc(doc(getDb(), "employees", id), {
    name: n,
    active: data.active !== false,
    createdAt: data.createdAt ?? now,
    updatedAt: now,
  });
}

export async function updateEmployee(
  id: string,
  patch: Partial<Pick<Employee, "name" | "active">>,
): Promise<void> {
  const next: Record<string, string | boolean | number> = { updatedAt: Date.now() };
  if (patch.name != null) {
    const n = patch.name.trim();
    if (!n) throw new Error("ต้องใส่ชื่อพนักงาน");
    next.name = n;
  }
  if (patch.active != null) next.active = patch.active;
  await updateDoc(doc(getDb(), "employees", id), next);
}
