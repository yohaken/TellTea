/**
 * ข้อมูลจ่ายอ่อนไหว — แยกจาก employees (รายชื่อร้าน)
 * อ่านได้: เจ้าของ / สิทธิ์ payrollPay / พนักงานดูของตัวเองเท่านั้น
 */
import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  type DocumentData,
} from "firebase/firestore";
import { getDb } from "./firebase";
import type { Employee } from "./employees";

export type EmployeePayFields = {
  monthlySalary?: number;
  payBank?: string;
  payAccountNo?: string;
  payAccountName?: string;
  advanceBalance?: number;
  skipGroupPayroll?: boolean;
};

const PAY_KEYS = [
  "monthlySalary",
  "payBank",
  "payAccountNo",
  "payAccountName",
  "advanceBalance",
  "skipGroupPayroll",
] as const;

export type EmployeePayPatch = {
  monthlySalary?: number | null;
  payBank?: string | null;
  payAccountNo?: string | null;
  payAccountName?: string | null;
  advanceBalance?: number | null;
  skipGroupPayroll?: boolean | null;
};

function payRef(employeeId: string) {
  return doc(getDb(), "employeePay", employeeId);
}

function payCol() {
  return collection(getDb(), "employeePay");
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function stripPayFields<T extends Record<string, unknown>>(data: T): T {
  const next = { ...data };
  for (const key of PAY_KEYS) delete next[key];
  return next;
}

export function mapEmployeePay(data: DocumentData | undefined | null): EmployeePayFields {
  if (!data) return {};
  const out: EmployeePayFields = {};
  const salary = Number(data.monthlySalary);
  if (Number.isFinite(salary) && salary > 0) out.monthlySalary = round2(salary);
  const bank = String(data.payBank || "").trim();
  if (bank) out.payBank = bank;
  const accNo = String(data.payAccountNo || "").trim();
  if (accNo) out.payAccountNo = accNo;
  const accName = String(data.payAccountName || "").trim();
  if (accName) out.payAccountName = accName;
  const adv = Number(data.advanceBalance);
  if (Number.isFinite(adv) && adv > 0) out.advanceBalance = round2(adv);
  if (data.skipGroupPayroll === true) out.skipGroupPayroll = true;
  return out;
}

export function mergeEmployeePay(emp: Employee, pay: EmployeePayFields | null | undefined): Employee {
  if (!pay) return { ...emp };
  return { ...emp, ...pay };
}

export function legacyPayFromEmployeeDoc(data: DocumentData): EmployeePayFields {
  return mapEmployeePay(data);
}

export function employeeDocHasLegacyPay(data: DocumentData): boolean {
  return PAY_KEYS.some((k) => {
    const v = data[k];
    if (v == null || v === "") return false;
    if (k === "skipGroupPayroll") return v === true;
    return true;
  });
}

export async function getEmployeePay(employeeId: string): Promise<EmployeePayFields> {
  const snap = await getDoc(payRef(employeeId));
  return mapEmployeePay(snap.exists() ? snap.data() : null);
}

export async function listEmployeePayMap(): Promise<Map<string, EmployeePayFields>> {
  const snap = await getDocs(payCol());
  const map = new Map<string, EmployeePayFields>();
  for (const d of snap.docs) {
    map.set(d.id, mapEmployeePay(d.data()));
  }
  return map;
}

export async function setEmployeePay(
  employeeId: string,
  patch: EmployeePayPatch,
): Promise<EmployeePayFields> {
  const next: Record<string, unknown> = { updatedAt: Date.now() };

  if (patch.monthlySalary !== undefined) {
    const n = Number(patch.monthlySalary);
    next.monthlySalary =
      patch.monthlySalary == null || !Number.isFinite(n) || n <= 0
        ? deleteField()
        : round2(n);
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
        : round2(n);
  }
  if (patch.skipGroupPayroll !== undefined) {
    next.skipGroupPayroll = patch.skipGroupPayroll ? true : deleteField();
  }

  await setDoc(payRef(employeeId), next, { merge: true });
  return getEmployeePay(employeeId);
}

/** ย้าย field จ่ายจาก employees → employeePay แล้วลบออกจาก roster doc */
export async function migrateEmployeePayFromLegacyDoc(
  employeeId: string,
  legacy: DocumentData,
): Promise<boolean> {
  if (!employeeDocHasLegacyPay(legacy)) return false;

  const fromLegacy = mapEmployeePay(legacy);
  const existing = await getEmployeePay(employeeId);
  const patch: EmployeePayPatch = {};

  if (existing.monthlySalary == null && fromLegacy.monthlySalary != null) {
    patch.monthlySalary = fromLegacy.monthlySalary;
  }
  if (existing.payBank == null && fromLegacy.payBank != null) {
    patch.payBank = fromLegacy.payBank;
  }
  if (existing.payAccountNo == null && fromLegacy.payAccountNo != null) {
    patch.payAccountNo = fromLegacy.payAccountNo;
  }
  if (existing.payAccountName == null && fromLegacy.payAccountName != null) {
    patch.payAccountName = fromLegacy.payAccountName;
  }
  if (existing.advanceBalance == null && fromLegacy.advanceBalance != null) {
    patch.advanceBalance = fromLegacy.advanceBalance;
  }
  if (existing.skipGroupPayroll == null && fromLegacy.skipGroupPayroll != null) {
    patch.skipGroupPayroll = fromLegacy.skipGroupPayroll;
  }

  if (Object.keys(patch).length) {
    await setEmployeePay(employeeId, patch);
  }

  const strip: Record<string, unknown> = { updatedAt: Date.now() };
  for (const key of PAY_KEYS) strip[key] = deleteField();
  await updateDoc(doc(getDb(), "employees", employeeId), strip);
  return true;
}

/** สแกน roster ทั้งร้าน — เรียกตอนเจ้าของเปิดหน้าจ่าย/ศูนย์พนักงาน */
export async function migrateAllLegacyEmployeePay(): Promise<number> {
  const snap = await getDocs(collection(getDb(), "employees"));
  let n = 0;
  for (const d of snap.docs) {
    if (await migrateEmployeePayFromLegacyDoc(d.id, d.data())) n += 1;
  }
  return n;
}

export async function adjustEmployeePayAdvanceBalance(
  employeeId: string,
  delta: number,
): Promise<number> {
  const current = await getEmployeePay(employeeId);
  let prev = Math.max(0, Number(current.advanceBalance) || 0);
  if (!(prev > 0)) {
    const empSnap = await getDoc(doc(getDb(), "employees", employeeId));
    if (empSnap.exists()) {
      prev = Math.max(0, Number(empSnap.data().advanceBalance) || 0);
    }
  }
  const next = round2(Math.max(0, prev + (Number(delta) || 0)));
  await setEmployeePay(employeeId, { advanceBalance: next > 0 ? next : null });
  try {
    await updateDoc(doc(getDb(), "employees", employeeId), {
      advanceBalance: deleteField(),
      updatedAt: Date.now(),
    });
  } catch {
    /* roster may already be clean */
  }
  return next;
}
