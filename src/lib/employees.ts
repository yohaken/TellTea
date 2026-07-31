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
import {
  adjustEmployeePayAdvanceBalance,
  getEmployeePay,
  legacyPayFromEmployeeDoc,
  listEmployeePayMap,
  mergeEmployeePay,
  migrateAllLegacyEmployeePay,
  setEmployeePay,
  stripPayFields,
} from "./employee-pay";
import { getDb } from "./firebase";
import type { StaffMember } from "./types";
import { normalizeEmail, normalizePhone } from "./utils";

export { migrateAllLegacyEmployeePay };

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
  /**
   * true = ข้ามตอนกด «สร้างเงินเดือน/โบนัส» กลุ่ม
   * ใช้กับพนักงานใหม่ที่จ่ายแยกก่อนเข้าวรรอบปกติ
   */
  skipGroupPayroll?: boolean;
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

function mapEmployeeRoster(id: string, data: Record<string, unknown>): Employee {
  const clean = stripPayFields(data);
  return {
    id,
    name: String(clean.name || ""),
    nickname: clean.nickname ? String(clean.nickname) : undefined,
    active: clean.active !== false,
    linkedEmail: clean.linkedEmail ? String(clean.linkedEmail) : undefined,
    linkedPhone: clean.linkedPhone ? String(clean.linkedPhone) : undefined,
    linkedStaffId: clean.linkedStaffId ? String(clean.linkedStaffId) : undefined,
    unitRate:
      clean.unitRate != null && Number(clean.unitRate) > 0
        ? Number(clean.unitRate)
        : undefined,
    createdAt: Number(clean.createdAt) || 0,
    updatedAt: Number(clean.updatedAt) || 0,
  };
}

/** รายชื่อร้านเท่านั้น — ไม่รวมเงินเดือน/บัญชี (แม้ legacy field ยังอยู่ใน doc) */
export async function listEmployees(): Promise<Employee[]> {
  const snap = await getDocs(query(employeesCol(), orderBy("name", "asc")));
  return snap.docs.map((d) => mapEmployeeRoster(d.id, d.data() as Record<string, unknown>));
}

export async function listActiveEmployees(): Promise<Employee[]> {
  return (await listEmployees()).filter((e) => e.active);
}

/**
 * รายชื่อ + ข้อมูลจ่าย (employeePay + legacy ระหว่าง migrate)
 * ใช้เฉพาะเจ้าของ / คนมีสิทธิ์ payrollPay — staff ทั่วไปเรียกแล้ว rules จะบล็อก list employeePay
 */
export async function listEmployeesWithPay(): Promise<Employee[]> {
  const [raw, payMap] = await Promise.all([
    getDocs(query(employeesCol(), orderBy("name", "asc"))),
    listEmployeePayMap(),
  ]);
  return raw.docs.map((d) => {
    const roster = mapEmployeeRoster(d.id, d.data() as Record<string, unknown>);
    const fromLegacy = legacyPayFromEmployeeDoc(d.data());
    const fromPay = payMap.get(d.id);
    return mergeEmployeePay(roster, { ...fromLegacy, ...fromPay });
  });
}

export async function listActiveEmployeesWithPay(): Promise<Employee[]> {
  return (await listEmployeesWithPay()).filter((e) => e.active);
}

/** โหลดข้อมูลจ่ายของแถวเดียว (ตัวเอง หรือคนมีสิทธิ์) */
export async function getEmployeeWithPay(employeeId: string): Promise<Employee | null> {
  const snap = await getDoc(doc(getDb(), "employees", employeeId));
  if (!snap.exists()) return null;
  const roster = mapEmployeeRoster(employeeId, snap.data() as Record<string, unknown>);
  let pay = await getEmployeePay(employeeId);
  if (!Object.keys(pay).length) {
    pay = legacyPayFromEmployeeDoc(snap.data());
  }
  return mergeEmployeePay(roster, pay);
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
      | "skipGroupPayroll"
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

  const payPatch: Parameters<typeof setEmployeePay>[1] = {};
  let hasPayPatch = false;
  if (patch.monthlySalary !== undefined) {
    payPatch.monthlySalary = patch.monthlySalary;
    hasPayPatch = true;
    next.monthlySalary = deleteField();
  }
  if (patch.payBank !== undefined) {
    payPatch.payBank = patch.payBank;
    hasPayPatch = true;
    next.payBank = deleteField();
  }
  if (patch.payAccountNo !== undefined) {
    payPatch.payAccountNo = patch.payAccountNo;
    hasPayPatch = true;
    next.payAccountNo = deleteField();
  }
  if (patch.payAccountName !== undefined) {
    payPatch.payAccountName = patch.payAccountName;
    hasPayPatch = true;
    next.payAccountName = deleteField();
  }
  if (patch.advanceBalance !== undefined) {
    payPatch.advanceBalance = patch.advanceBalance;
    hasPayPatch = true;
    next.advanceBalance = deleteField();
  }
  if (patch.skipGroupPayroll !== undefined) {
    payPatch.skipGroupPayroll = patch.skipGroupPayroll;
    hasPayPatch = true;
    next.skipGroupPayroll = deleteField();
  }

  if (hasPayPatch) {
    await setEmployeePay(id, payPatch);
  }
  await updateDoc(doc(getDb(), "employees", id), next);
}

/** ปรับยอดเบิกค้าง (+ เพิ่มเมื่อเบิกใหม่ / − ตอนหักจากเงินเดือน) */
export async function adjustEmployeeAdvanceBalance(
  id: string,
  delta: number,
): Promise<number> {
  const snap = await getDoc(doc(getDb(), "employees", id));
  if (!snap.exists()) throw new Error("ไม่พบพนักงาน");
  return adjustEmployeePayAdvanceBalance(id, delta);
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
