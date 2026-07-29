import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
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
  /** ชื่อเล่นสั้น — ใช้ไอคอน presence ของเจ้าของ (1–2 ตัว) */
  nickname?: string;
  active: boolean;
  /** อีเมลบัญชีที่เชื่อม (legacy / Google) */
  linkedEmail?: string;
  /** เบอร์โทรที่เชื่อม (OTP) */
  linkedPhone?: string;
  /** staff doc id — canonical link */
  linkedStaffId?: string;
  /** เรท/ค่าต่อหน่วย (optional — ลบได้โดยเคลียร์ค่า) */
  unitRate?: number;
  /** เงินเดือนต่อเดือน (บาท) — ใช้สร้างรายการรอโอน */
  monthlySalary?: number;
  /** ธนาคารรับโอน (optional) */
  payBank?: string;
  /** เลขบัญชีรับโอน (optional) */
  payAccountNo?: string;
  /** ชื่อบัญชีรับโอน (optional) */
  payAccountName?: string;
  /**
   * ยอดเบิกล่วงหน้าค้างหัก (บาท)
   * หักจากรอบเงินเดือน/โบนัสตอนสร้างคิวจ่าย — ตัดยอดจริงตอน mark จ่ายแล้ว
   */
  advanceBalance?: number;
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

/**
 * หาแถวพนักงานที่ผูกกับบัญชี staff — ใช้กรองคิวจ่าย/เงินเดือนมุมพนักงาน
 * ลำดับ: staff.employeeId → linkedStaffId/email/phone → ชื่อตรง displayName
 */
export function resolveLinkedEmployee(
  employees: Employee[],
  staff: Pick<StaffMember, "id" | "email" | "phone" | "displayName" | "employeeId"> | null | undefined,
): Employee | null {
  if (!staff || !employees.length) return null;
  if (staff.employeeId) {
    const byId = employees.find((e) => e.id === staff.employeeId);
    if (byId) return byId;
  }
  const linked = employees.find((e) => isLinkedToStaff(e, staff as StaffMember));
  if (linked) return linked;
  const name = (staff.displayName || "").trim().toLowerCase();
  if (!name) return null;
  return (
    employees.find((e) => e.active && e.name.trim().toLowerCase() === name) || null
  );
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

export async function addEmployee(name: string, nickname?: string): Promise<string> {
  const n = name.trim();
  if (!n) throw new Error("ต้องใส่ชื่อพนักงาน");
  const nick = nickname?.trim() || "";
  const now = Date.now();
  const ref = await addDoc(employeesCol(), {
    name: n,
    ...(nick ? { nickname: nick } : {}),
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
    Pick<
      Employee,
      | "name"
      | "nickname"
      | "active"
      | "linkedEmail"
      | "linkedPhone"
      | "linkedStaffId"
      | "unitRate"
      | "monthlySalary"
      | "payBank"
      | "payAccountNo"
      | "payAccountName"
      | "advanceBalance"
    >
  >,
): Promise<void> {
  const next: Record<string, unknown> = { updatedAt: Date.now() };
  if (patch.name != null) {
    const n = patch.name.trim();
    if (!n) throw new Error("ต้องใส่ชื่อพนักงาน");
    next.name = n;
  }
  if (patch.nickname !== undefined) {
    const nick = patch.nickname?.trim() || "";
    next.nickname = nick ? nick : deleteField();
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
  if (patch.monthlySalary !== undefined) {
    const n = Number(patch.monthlySalary);
    next.monthlySalary =
      patch.monthlySalary == null || !Number.isFinite(n) || n <= 0
        ? deleteField()
        : Math.round(n * 100) / 100;
  }
  if (patch.payBank !== undefined) {
    const v = (patch.payBank || "").trim();
    next.payBank = v ? v : deleteField();
  }
  if (patch.payAccountNo !== undefined) {
    const v = (patch.payAccountNo || "").trim();
    next.payAccountNo = v ? v : deleteField();
  }
  if (patch.payAccountName !== undefined) {
    const v = (patch.payAccountName || "").trim();
    next.payAccountName = v ? v : deleteField();
  }
  if (patch.advanceBalance !== undefined) {
    const n = Number(patch.advanceBalance);
    next.advanceBalance =
      patch.advanceBalance == null || !Number.isFinite(n) || n <= 0
        ? deleteField()
        : Math.round(n * 100) / 100;
  }
  await updateDoc(doc(getDb(), "employees", id), next);
}

/** ปรับยอดเบิกค้าง (+ เพิ่มเมื่อเบิกใหม่ / − ตอนหักจากเงินเดือน) */
export async function adjustEmployeeAdvanceBalance(
  id: string,
  delta: number,
): Promise<number> {
  const ref = doc(getDb(), "employees", id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("ไม่พบพนักงาน");
  const prev = Math.max(0, Number(snap.data().advanceBalance) || 0);
  const next = Math.round(Math.max(0, prev + (Number(delta) || 0)) * 100) / 100;
  await updateDoc(ref, {
    advanceBalance: next > 0 ? next : deleteField(),
    updatedAt: Date.now(),
  });
  return next;
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
