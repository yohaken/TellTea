import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  getDocsFromServer,
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
  /**
   * ชื่อในร้าน/ชื่อเล่นเก่า — ใช้รวมโบนัส/OT/ผลิตหลังเปลี่ยนชื่อ
   * ให้คนเดิมยังเป็นคนเดียวกันแม้แถวเก่าเก็บชื่อ x1 ไว้
   */
  previousNames?: string[];
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
 * หาแถวพนักงานที่ผูกกับบัญชี staff — ใช้กรองคิวจ่าย/โบนัส/ชง/ผลิต
 * ลำดับ: ลิงก์ canonical (linkedStaffId/email/phone) → staff.employeeId → ชื่อ/ชื่อเล่น
 * ให้ลิงก์ชนะ employeeId ที่ค้างผิด — กันเคสใส่ยอดชง/เบเกอรี่แล้วโบนัสฝั่งพนักงานไม่ขึ้น
 */
export function resolveLinkedEmployee(
  employees: Employee[],
  staff: Pick<StaffMember, "id" | "email" | "phone" | "displayName" | "employeeId"> | null | undefined,
): Employee | null {
  if (!staff || !employees.length) return null;
  const byLink = employees.find((e) => isLinkedToStaff(e, staff as StaffMember));
  if (byLink) return byLink;
  if (staff.employeeId) {
    const byId = employees.find((e) => e.id === staff.employeeId);
    if (byId) return byId;
  }
  const name = (staff.displayName || "").trim().toLowerCase();
  if (!name) return null;
  return (
    employees.find((e) => {
      if (!e.active) return false;
      if (e.name.trim().toLowerCase() === name) return true;
      const nick = (e.nickname || "").trim().toLowerCase();
      return !!nick && nick === name;
    }) || null
  );
}

/** employees/{id} สำหรับกรองรายการ "ของฉัน" (ผลิต/ชง/โบนัส) */
export function resolveMyWorkerId(
  employees: Employee[],
  staff: Pick<StaffMember, "id" | "email" | "phone" | "displayName" | "employeeId"> | null | undefined,
): string {
  return resolveLinkedEmployee(employees, staff)?.id || "";
}

function isUnlinked(emp: Employee): boolean {
  return !emp.linkedStaffId && !emp.linkedEmail && !emp.linkedPhone;
}

/**
 * ถ้าเปลี่ยนชื่อเล่น และชื่อในร้านยังเป็นชื่อเล่นเก่า — ให้ชื่อในร้านตามไปด้วย
 * (เคสร้านเล็กที่ใช้ชื่อสั้นชื่อเดียวทั้งคู่ เช่น x1 → jay)
 */
export function planEmployeeIdentityPatch(
  current: Pick<Employee, "name" | "nickname">,
  patch: { name?: string; nickname?: string },
): { name?: string; nickname?: string } {
  const oldName = current.name.trim();
  const oldNick = (current.nickname || "").trim();
  const nextNick =
    patch.nickname !== undefined ? patch.nickname.trim() : undefined;
  let nextName = patch.name !== undefined ? patch.name.trim() : undefined;

  if (nextNick !== undefined && nextNick && nextNick !== oldNick) {
    const effectiveName = nextName !== undefined ? nextName : oldName;
    if (effectiveName === oldNick) {
      nextName = nextNick;
    }
  }

  const out: { name?: string; nickname?: string } = {};
  if (nextName !== undefined) out.name = nextName;
  if (nextNick !== undefined) out.nickname = nextNick;
  return out;
}

/** ซิงก์ staff.displayName ให้ตรงชื่อในร้าน — กันตารางพร้อม/OT/โปรไฟล์ค้างชื่อเก่า */
async function syncLinkedStaffDisplayName(
  employeeId: string,
  displayName: string,
  linkedStaffId?: string | null,
): Promise<void> {
  const name = displayName.trim();
  if (!name) return;
  const db = getDb();
  const staffIds = new Set<string>();
  if (linkedStaffId?.trim()) staffIds.add(linkedStaffId.trim());
  try {
    const byEmp = await getDocs(
      query(collection(db, "staff"), where("employeeId", "==", employeeId)),
    );
    for (const d of byEmp.docs) staffIds.add(d.id);
  } catch {
    /* index / offline — still try linkedStaffId */
  }
  await Promise.all(
    [...staffIds].map((sid) =>
      updateDoc(doc(db, "staff", sid), { displayName: name }).catch(() => {
        /* best-effort */
      }),
    ),
  );
}

function mapPreviousNames(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const names = raw
    .map((n) => String(n || "").trim())
    .filter(Boolean);
  return names.length ? [...new Set(names)] : undefined;
}

function mapEmployeeRoster(id: string, data: Record<string, unknown>): Employee {
  const clean = stripPayFields(data);
  return {
    id,
    name: String(clean.name || ""),
    nickname: clean.nickname ? String(clean.nickname) : undefined,
    previousNames: mapPreviousNames(clean.previousNames),
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

/** รวมชื่อเก่าไว้บน roster — โบนัส/OT จับคนเดิมได้หลังเปลี่ยนชื่อ */
export function mergePreviousNames(
  current: Pick<Employee, "name" | "nickname" | "previousNames">,
  next: { name?: string; nickname?: string },
): string[] {
  const aliases = new Set<string>(
    (current.previousNames || []).map((n) => n.trim()).filter(Boolean),
  );
  const curName = current.name.trim();
  const curNick = (current.nickname || "").trim();
  if (next.name != null) {
    const n = next.name.trim();
    if (curName && n && curName !== n) aliases.add(curName);
  }
  if (next.nickname !== undefined) {
    const n = next.nickname.trim();
    if (curNick && n !== curNick) aliases.add(curNick);
    // ชื่อในร้านตามชื่อเล่นเก่าไปด้วย — เก็บชื่อเล่น/ชื่อเก่าทั้งคู่
    if (curName && n && curName !== n && curName === curNick) aliases.add(curName);
  }
  // อย่าเก็บชื่อปัจจุบันซ้ำใน aliases
  const live = new Set<string>();
  if (next.name != null && next.name.trim()) live.add(next.name.trim());
  else if (curName) live.add(curName);
  if (next.nickname !== undefined) {
    if (next.nickname.trim()) live.add(next.nickname.trim());
  } else if (curNick) live.add(curNick);
  return [...aliases].filter((a) => !live.has(a));
}

/** รายชื่อร้านเท่านั้น — ไม่รวมเงินเดือน/บัญชี (แม้ legacy field ยังอยู่ใน doc) */
export async function listEmployees(): Promise<Employee[]> {
  const snap = await getDocs(query(employeesCol(), orderBy("name", "asc")));
  return snap.docs.map((d) => mapEmployeeRoster(d.id, d.data() as Record<string, unknown>));
}

export async function listActiveEmployees(): Promise<Employee[]> {
  return (await listEmployees()).filter((e) => e.active);
}

/** Server-only roster — หน้างานพนักงานไม่พึ่ง offline cache */
export async function listActiveEmployeesFromServer(): Promise<Employee[]> {
  const snap = await getDocsFromServer(query(employeesCol(), orderBy("name", "asc")));
  return snap.docs
    .map((d) => mapEmployeeRoster(d.id, d.data() as Record<string, unknown>))
    .filter((e) => e.active);
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
  // แยก roster (ชื่อ/ชื่อเล่น) กับ pay — เขียน roster ก่อนเสมอ
  // กันกรณี setEmployeePay พังแล้วชื่อเล่นไม่ถูกบันทึก
  let effective = patch;
  let linkedStaffIdForSync: string | undefined;
  let currentForAlias: Employee | undefined;
  if (patch.name != null || patch.nickname !== undefined) {
    const curSnap = await getDoc(doc(getDb(), "employees", id));
    if (!curSnap.exists()) throw new Error("ไม่พบพนักงาน");
    const cur = mapEmployeeRoster(id, curSnap.data() as Record<string, unknown>);
    currentForAlias = cur;
    linkedStaffIdForSync = cur.linkedStaffId;
    const identity = planEmployeeIdentityPatch(cur, {
      name: patch.name,
      nickname: patch.nickname,
    });
    effective = {
      ...patch,
      ...(identity.name !== undefined ? { name: identity.name } : {}),
      ...(identity.nickname !== undefined ? { nickname: identity.nickname } : {}),
    };
  }

  const roster: Record<string, unknown> = { updatedAt: Date.now() };
  let hasRosterPatch = false;
  let wroteName: string | undefined;
  if (effective.name != null) {
    const n = effective.name.trim();
    if (!n) throw new Error("ต้องใส่ชื่อพนักงาน");
    roster.name = n;
    wroteName = n;
    hasRosterPatch = true;
  }
  if (effective.nickname !== undefined) {
    const nick = effective.nickname?.trim() || "";
    roster.nickname = nick ? nick : deleteField();
    hasRosterPatch = true;
  }
  if (currentForAlias && (effective.name != null || effective.nickname !== undefined)) {
    const aliases = mergePreviousNames(currentForAlias, {
      name: effective.name,
      nickname: effective.nickname,
    });
    if (aliases.length) {
      roster.previousNames = aliases;
      hasRosterPatch = true;
    }
  }
  if (patch.active != null) {
    roster.active = patch.active;
    hasRosterPatch = true;
  }
  if (patch.linkedEmail !== undefined) {
    roster.linkedEmail = patch.linkedEmail
      ? normalizeEmail(patch.linkedEmail)
      : deleteField();
    hasRosterPatch = true;
  }
  if (patch.linkedPhone !== undefined) {
    roster.linkedPhone = patch.linkedPhone
      ? normalizePhone(patch.linkedPhone)
      : deleteField();
    hasRosterPatch = true;
  }
  if (effective.linkedStaffId !== undefined) {
    roster.linkedStaffId =
      effective.linkedStaffId && effective.linkedStaffId.trim()
        ? effective.linkedStaffId.trim()
        : deleteField();
    linkedStaffIdForSync = effective.linkedStaffId?.trim() || undefined;
    hasRosterPatch = true;
  }
  if (patch.unitRate !== undefined) {
    roster.unitRate =
      patch.unitRate == null || patch.unitRate === 0 ? deleteField() : patch.unitRate;
    hasRosterPatch = true;
  }

  if (hasRosterPatch) {
    await updateDoc(doc(getDb(), "employees", id), roster);
  }

  const payPatch: Parameters<typeof setEmployeePay>[1] = {};
  let hasPayPatch = false;
  if (patch.monthlySalary !== undefined) {
    payPatch.monthlySalary = patch.monthlySalary;
    hasPayPatch = true;
  }
  if (patch.payBank !== undefined) {
    payPatch.payBank = patch.payBank;
    hasPayPatch = true;
  }
  if (patch.payAccountNo !== undefined) {
    payPatch.payAccountNo = patch.payAccountNo;
    hasPayPatch = true;
  }
  if (patch.payAccountName !== undefined) {
    payPatch.payAccountName = patch.payAccountName;
    hasPayPatch = true;
  }
  if (patch.advanceBalance !== undefined) {
    payPatch.advanceBalance = patch.advanceBalance;
    hasPayPatch = true;
  }
  if (patch.skipGroupPayroll !== undefined) {
    payPatch.skipGroupPayroll = patch.skipGroupPayroll;
    hasPayPatch = true;
  }

  if (hasPayPatch) {
    await setEmployeePay(id, payPatch);
    // ลบ field จ่าย legacy ออกจาก roster (best-effort)
    const strip: Record<string, unknown> = { updatedAt: Date.now() };
    for (const key of [
      "monthlySalary",
      "payBank",
      "payAccountNo",
      "payAccountName",
      "advanceBalance",
      "skipGroupPayroll",
    ] as const) {
      strip[key] = deleteField();
    }
    try {
      await updateDoc(doc(getDb(), "employees", id), strip);
    } catch {
      /* roster may already be clean / offline */
    }
  }

  // ยืนยันชื่อเล่นถูกเขียนจริง (กัน UI โชว์ค่าใหม่ทั้งที่ Firestore ยังเป็นค่าเก่า)
  if (effective.nickname !== undefined) {
    const snap = await getDoc(doc(getDb(), "employees", id));
    if (!snap.exists()) throw new Error("ไม่พบพนักงานหลังบันทึก");
    const want = effective.nickname.trim();
    const got = String(snap.data()?.nickname || "").trim();
    if (want !== got) {
      throw new Error("บันทึกชื่อเล่นไม่สำเร็จ — ลองอีกครั้ง");
    }
  }

  if (wroteName) {
    await syncLinkedStaffDisplayName(id, wroteName, linkedStaffIdForSync);
    // ชื่อเปลี่ยน = คนเดิม — กระจายชื่อใหม่ไปชง/ผลิต/งาน/คิวจ่าย (ไม่สร้าง id ใหม่)
    const oldNames = currentForAlias
      ? mergePreviousNames(currentForAlias, {
          name: effective.name,
          nickname: effective.nickname,
        })
      : [];
    if (
      currentForAlias &&
      (currentForAlias.name.trim() !== wroteName || oldNames.length > 0)
    ) {
      try {
        const { propagateEmployeeRename } = await import("./employee-rename-propagate");
        await propagateEmployeeRename(id, wroteName, [
          currentForAlias.name,
          currentForAlias.nickname || "",
          ...oldNames,
        ]);
      } catch (err) {
        if (typeof console !== "undefined") {
          console.warn("[updateEmployee] rename propagate failed", err);
        }
      }
    }
  }
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

export async function ensureStaffEmployeeLink(
  staff: Pick<StaffMember, "id" | "email" | "phone">,
  employee: Employee,
): Promise<void> {
  if (isLinkedToStaff(employee, staff as StaffMember)) return;
  if (employee.linkedStaffId && employee.linkedStaffId !== staff.id) return;
  try {
    await linkEmployeeProfile(
      employee.id,
      staff.id,
      employee.name,
      staff.email,
      staff.phone,
    );
  } catch {
    /* best-effort — rules อาจรอ email/phone ตรง */
  }
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
