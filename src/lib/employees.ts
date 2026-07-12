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
import type { StaffMember } from "./types";
import { normalizeEmail, normalizePhone } from "./utils";

/** Shared shop employee roster — one place, used by production and future modules. */
export type Employee = {
  id: string;
  name: string;
  active: boolean;
  /** อีเมลบัญชีที่เชื่อม (legacy / Google) */
  linkedEmail?: string;
  /** เบอร์โทรที่เชื่อม (OTP) */
  linkedPhone?: string;
  /** staff doc id — canonical link */
  linkedStaffId?: string;
  /** เรท/ค่าต่อหน่วย (optional — ลบได้โดยเคลียร์ค่า) */
  unitRate?: number;
  createdAt: number;
  updatedAt: number;
};

function employeesCol() {
  return collection(getDb(), "employees");
}

function isLinkedToStaff(emp: Employee, staff: StaffMember): boolean {
  if (emp.linkedStaffId) return emp.linkedStaffId === staff.id;
  if (staff.email && emp.linkedEmail) {
    return normalizeEmail(emp.linkedEmail) === normalizeEmail(staff.email);
  }
  if (staff.phone && emp.linkedPhone) {
    return normalizePhone(emp.linkedPhone) === normalizePhone(staff.phone);
  }
  return false;
}

function isUnlinked(emp: Employee): boolean {
  return !emp.linkedStaffId && !emp.linkedEmail && !emp.linkedPhone;
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
  patch: Partial<
    Pick<Employee, "name" | "active" | "linkedEmail" | "linkedPhone" | "linkedStaffId" | "unitRate">
  >,
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
  if (patch.linkedPhone !== undefined) {
    next.linkedPhone = patch.linkedPhone
      ? normalizePhone(patch.linkedPhone)
      : deleteField();
  }
  if (patch.linkedStaffId !== undefined) {
    next.linkedStaffId =
      patch.linkedStaffId && patch.linkedStaffId.trim()
        ? patch.linkedStaffId.trim()
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

/** ชื่อที่ยังไม่มีบัญชีเชื่อม หรือเชื่อมกับบัญชีนี้อยู่แล้ว */
export async function listEmployeesForProfile(staff: StaffMember): Promise<Employee[]> {
  const active = await listActiveEmployees();
  return active.filter((e) => isUnlinked(e) || isLinkedToStaff(e, staff));
}

export async function linkEmployeeProfile(
  employeeId: string,
  staffId: string,
  displayName: string,
  email?: string,
  phone?: string,
): Promise<void> {
  const employees = await listActiveEmployees();
  const target = employees.find((e) => e.id === employeeId);
  if (!target) throw new Error("ไม่พบชื่อในรายชื่อร้าน");
  if (target.linkedStaffId && target.linkedStaffId !== staffId) {
    throw new Error("ชื่อนี้มีคนเชื่อมบัญชีแล้ว");
  }
  for (const e of employees) {
    if (e.id === employeeId) continue;
    if (e.linkedStaffId === staffId) {
      await updateDoc(doc(getDb(), "employees", e.id), {
        linkedEmail: deleteField(),
        linkedPhone: deleteField(),
        linkedStaffId: deleteField(),
        updatedAt: Date.now(),
      });
    }
  }
  const patch: Partial<Pick<Employee, "linkedEmail" | "linkedPhone" | "linkedStaffId" | "name">> = {
    linkedStaffId: staffId,
    name: displayName.trim() || target.name,
  };
  if (email) patch.linkedEmail = normalizeEmail(email);
  if (phone) patch.linkedPhone = normalizePhone(phone);
  await updateEmployee(employeeId, patch);
}

export async function clearEmployeeLinkByStaffId(staffId: string): Promise<void> {
  const snap = await getDocs(query(employeesCol(), where("linkedStaffId", "==", staffId)));
  await Promise.all(
    snap.docs.map((d) =>
      updateDoc(doc(getDb(), "employees", d.id), {
        linkedEmail: deleteField(),
        linkedPhone: deleteField(),
        linkedStaffId: deleteField(),
        updatedAt: Date.now(),
      }),
    ),
  );
}

/** @deprecated use clearEmployeeLinkByStaffId */
export async function clearEmployeeLinkByEmail(email: string): Promise<void> {
  const normalized = normalizeEmail(email);
  const snap = await getDocs(
    query(employeesCol(), where("linkedEmail", "==", normalized)),
  );
  await Promise.all(
    snap.docs.map((d) =>
      updateDoc(doc(getDb(), "employees", d.id), {
        linkedEmail: deleteField(),
        linkedPhone: deleteField(),
        linkedStaffId: deleteField(),
        updatedAt: Date.now(),
      }),
    ),
  );
}

export function employeeLinkLabel(emp: Employee): string {
  if (emp.linkedStaffId && emp.linkedEmail) return `เชื่อม ${emp.linkedEmail} ✓`;
  if (emp.linkedStaffId && emp.linkedPhone) return `เชื่อม ${emp.linkedPhone} ✓`;
  if (emp.linkedEmail) return `เชื่อม ${emp.linkedEmail} ✓`;
  if (emp.linkedPhone) return `เชื่อม ${emp.linkedPhone} ✓`;
  return "ยังไม่มีบัญชี";
}

export function employeesForLink(employees: Employee[], staffId?: string): Employee[] {
  return employees.filter(
    (e) => e.active && (isUnlinked(e) || (staffId != null && e.linkedStaffId === staffId)),
  );
}
