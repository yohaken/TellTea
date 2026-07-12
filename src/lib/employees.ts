import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { normalizeEmail } from "./utils";

/** Shared shop employee roster — one place, used by production and future modules. */
export type Employee = {
  id: string;
  name: string;
  active: boolean;
  /** อีเมลบัญชีที่เชื่อม (ถ้าพนักงานตั้งโปรไฟล์แล้ว) */
  linkedEmail?: string;
  /** เรท/ค่าต่อหน่วย (optional — ลบได้โดยเคลียร์ค่า) */
  unitRate?: number;
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
  patch: Partial<Pick<Employee, "name" | "active" | "linkedEmail" | "unitRate">>,
): Promise<void> {
  const next: Record<string, unknown> = { updatedAt: Date.now() };
  if (patch.name != null) {
    const n = patch.name.trim();
    if (!n) throw new Error("ต้องใส่ชื่อพนักงาน");
    next.name = n;
  }
  if (patch.active != null) next.active = patch.active;
  if (patch.linkedEmail !== undefined) {
    next.linkedEmail = patch.linkedEmail
      ? normalizeEmail(patch.linkedEmail)
      : deleteField();
  }
  if (patch.unitRate !== undefined) {
    next.unitRate =
      patch.unitRate == null || patch.unitRate === 0 ? deleteField() : patch.unitRate;
  }
  await updateDoc(doc(getDb(), "employees", id), next);
}

export async function deleteEmployee(id: string): Promise<void> {
  await deleteDoc(doc(getDb(), "employees", id));
}

/** ชื่อที่ยังไม่มีบัญชีเชื่อม หรือเชื่อมกับอีเมลนี้อยู่แล้ว */
export async function listEmployeesForProfile(email: string): Promise<Employee[]> {
  const normalized = normalizeEmail(email);
  const active = await listActiveEmployees();
  return active.filter((e) => !e.linkedEmail || normalizeEmail(e.linkedEmail) === normalized);
}

export async function linkEmployeeProfile(
  employeeId: string,
  email: string,
  displayName: string,
): Promise<void> {
  const normalized = normalizeEmail(email);
  const employees = await listActiveEmployees();
  const target = employees.find((e) => e.id === employeeId);
  if (!target) throw new Error("ไม่พบชื่อในรายชื่อร้าน");
  if (target.linkedEmail && normalizeEmail(target.linkedEmail) !== normalized) {
    throw new Error("ชื่อนี้มีคนเชื่อมบัญชีแล้ว");
  }
  for (const e of employees) {
    if (e.id === employeeId) continue;
    if (e.linkedEmail && normalizeEmail(e.linkedEmail) === normalized) {
      await updateDoc(doc(getDb(), "employees", e.id), {
        linkedEmail: deleteField(),
        updatedAt: Date.now(),
      });
    }
  }
  await updateEmployee(employeeId, { linkedEmail: normalized, name: displayName.trim() || target.name });
}

export async function clearEmployeeLinkByEmail(email: string): Promise<void> {
  const normalized = normalizeEmail(email);
  const snap = await getDocs(
    query(employeesCol(), where("linkedEmail", "==", normalized)),
  );
  await Promise.all(
    snap.docs.map((d) =>
      updateDoc(doc(getDb(), "employees", d.id), {
        linkedEmail: deleteField(),
        updatedAt: Date.now(),
      }),
    ),
  );
}
