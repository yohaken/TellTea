/**
 * Payroll — เงินเดือน + โบนัส รวมคิวรอโอนให้เจ้าของแนบสลิป
 *
 * ค่าเริ่มต้น: วันที่ 15 = 50% · วันที่ 1 = 50% ของเดือนที่แล้ว + โบนัสเดือนที่แล้ว
 * วัน/สัดส่วนปรับได้ใน meta/payrollSchedule
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { employeeMatchesName, isInMonth, namesMatch } from "./bonus";
import {
  adjustEmployeeAdvanceBalance,
  updateEmployee,
  type Employee,
} from "./employees";
import { getDb } from "./firebase";
import { addOwnerBookEntry } from "./owner-books";
import { bangkokCalendarParts } from "./task-weekly-logic";
import { bulkUpdateOtEntryStatus, type OtEntry } from "./ot";
import { bulkUpdateProdEntryStatus, type ProdEntry } from "./production";

export type PayrollKind =
  | "salary_mid"
  | "salary_month_end"
  | "bonus"
  /** จ่ายแยก / ยอดกำหนดเอง — ไม่ทับรอบกลาง-ปลาย */
  | "salary_special";
export type PayrollStatus = "pending" | "paid" | "void";

export type PayrollSalarySplit = {
  id: string;
  kind: "salary_mid" | "salary_month_end";
  /** 1–28 */
  dayOfMonth: number;
  percent: number;
  /** true = งวดนี้จ่ายของเดือนที่แล้ว (เช่น วันที่ 1) */
  forPreviousMonth: boolean;
};

export type PayrollSchedule = {
  salarySplits: PayrollSalarySplit[];
  bonusDayOfMonth: number;
  bonusWithSalaryEnd: boolean;
  bonusForPreviousMonth: boolean;
  updatedAt: number;
};

export type PayrollItem = {
  id: string;
  employeeId: string;
  employeeName: string;
  /** เดือนที่อ้างอิงค่าจ้าง/โบนัส YYYY-MM */
  periodMonth: string;
  kind: PayrollKind;
  /** วันโอนตามตาราง (เช่น วันที่ 1) — ใช้คิวจ่าย */
  dueDate: number;
  /**
   * วันลงบัญชี / ค่าใช้จ่ายในเดือน
   * งวดสิ้นเดือน+โบนัส = วันสุดท้ายของ periodMonth (ไม่ใช้วันที่ 1 เดือนถัดไป)
   */
  accountDate: number;
  /** ยอดก่อนหักเบิก */
  grossAmount: number;
  /** หักเบิกล่วงหน้าในรายการนี้ */
  advanceDeduct: number;
  /** ยอดโอนสุทธิ (= grossAmount - advanceDeduct) */
  amount: number;
  status: PayrollStatus;
  slipUrls: string[];
  note: string;
  paidAt: number;
  paidBy: string;
  ownerBookId: string;
  /** snapshot เงินเดือนเดือนตอนสร้าง */
  salaryBase: number;
  /** snapshot โบนัสคงเหลือตอนสร้าง */
  bonusRemaining: number;
  /** true เมื่อตัดยอดเบิกค้างของพนักงานแล้วตอนจ่าย */
  advanceApplied: boolean;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
};

export const PAYROLL_SLIP_MAX = 4;

export const DEFAULT_PAYROLL_SCHEDULE: PayrollSchedule = {
  salarySplits: [
    {
      id: "mid",
      kind: "salary_mid",
      dayOfMonth: 15,
      percent: 50,
      forPreviousMonth: false,
    },
    {
      id: "end",
      kind: "salary_month_end",
      dayOfMonth: 1,
      percent: 50,
      forPreviousMonth: true,
    },
  ],
  bonusDayOfMonth: 1,
  bonusWithSalaryEnd: true,
  bonusForPreviousMonth: true,
  updatedAt: 0,
};

export const PAYROLL_KIND_LABELS: Record<PayrollKind, string> = {
  salary_mid: "เงินเดือนงวดกลาง",
  salary_month_end: "เงินเดือนสิ้นเดือน",
  bonus: "โบนัส",
  salary_special: "เงินเดือนจ่ายแยก",
};

export const PAYROLL_STATUS_LABELS: Record<PayrollStatus, string> = {
  pending: "รอโอน",
  paid: "จ่ายแล้ว",
  void: "ยกเลิก",
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function clampDay(n: number) {
  const d = Math.round(Number(n) || 1);
  return Math.min(28, Math.max(1, d));
}

/** วันสุดท้ายของเดือน YYYY-MM (เที่ยง ICT) — ใช้ลงบัญชีงวดสิ้นเดือน */
export function periodMonthEndMs(periodMonth: string): number {
  const { year, monthIndex } = parsePeriodMonth(periodMonth);
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return bangkokNoonMs(year, monthIndex, lastDay);
}

/**
 * วันลงบัญชี: รอบที่จ่ายของเดือนที่แล้ว (วันที่ 1) → สิ้นเดือนของ periodMonth
 * รอบกลางเดือน → วันโอนในเดือนนั้น
 */
export function resolveAccountDate(
  periodMonth: string,
  dueDate: number,
  forPreviousMonth: boolean,
): number {
  if (forPreviousMonth) return periodMonthEndMs(periodMonth);
  return dueDate || periodMonthEndMs(periodMonth);
}

export function kindUsesMonthEndAccount(kind: PayrollKind): boolean {
  return kind === "salary_month_end" || kind === "bonus";
}

function scheduleRef() {
  return doc(getDb(), "meta", "payrollSchedule");
}

function payrollCol() {
  return collection(getDb(), "payrollItems");
}

export function periodMonthKey(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

export function parsePeriodMonth(key: string): { year: number; monthIndex: number } {
  const [y, m] = key.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    throw new Error("เดือนไม่ถูกต้อง");
  }
  return { year: y, monthIndex: m - 1 };
}

/** เที่ยงวันตามปฏิทินไทย (กันเลื่อนวันจาก timezone) — รองรับวันสิ้นเดือน 28–31 */
export function bangkokNoonMs(year: number, monthIndex: number, day: number): number {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const d = Math.min(lastDay, Math.max(1, Math.round(Number(day) || 1)));
  return Date.UTC(year, monthIndex, d, 5, 0, 0, 0); // 12:00 ICT = 05:00 UTC
}

export function shiftPeriodMonth(key: string, deltaMonths: number): string {
  const { year, monthIndex } = parsePeriodMonth(key);
  const d = new Date(Date.UTC(year, monthIndex + deltaMonths, 1));
  return periodMonthKey(d.getUTCFullYear(), d.getUTCMonth());
}

export function payrollItemDocId(
  employeeId: string,
  periodMonth: string,
  kind: Exclude<PayrollKind, "salary_special">,
): string {
  const safeEmp = employeeId.replace(/[^\w-]/g, "_").slice(0, 80);
  return `${safeEmp}_${periodMonth}_${kind}`;
}

/** จ่ายแยกได้หลายรายการต่อเดือน — ใส่ suffix ไม่ชน id */
export function payrollSpecialItemDocId(
  employeeId: string,
  periodMonth: string,
  suffix: string,
): string {
  const safeEmp = employeeId.replace(/[^\w-]/g, "_").slice(0, 80);
  const safeSuffix = String(suffix || Date.now())
    .replace(/[^\w-]/g, "_")
    .slice(0, 40);
  return `${safeEmp}_${periodMonth}_salary_special_${safeSuffix}`;
}

export function normalizePayrollSchedule(
  raw?: Partial<PayrollSchedule> | null,
): PayrollSchedule {
  const fallback = DEFAULT_PAYROLL_SCHEDULE;
  const splitsRaw = Array.isArray(raw?.salarySplits) ? raw!.salarySplits : [];
  const splits: PayrollSalarySplit[] = fallback.salarySplits.map((fb, i) => {
    const hit =
      splitsRaw.find((s) => s && (s.id === fb.id || s.kind === fb.kind)) ||
      splitsRaw[i];
    if (!hit) return { ...fb };
    return {
      id: typeof hit.id === "string" && hit.id.trim() ? hit.id.trim() : fb.id,
      kind: hit.kind === "salary_month_end" ? "salary_month_end" : "salary_mid",
      dayOfMonth: clampDay(hit.dayOfMonth ?? fb.dayOfMonth),
      percent: Math.max(0, Math.min(100, Number(hit.percent) || 0)),
      forPreviousMonth: Boolean(hit.forPreviousMonth),
    };
  });
  // ถ้าผู้ใช้แก้เปอร์เซ็นต์เอง ให้คงค่า — ไม่บังคับรวม 100
  return {
    salarySplits: splits,
    bonusDayOfMonth: clampDay(raw?.bonusDayOfMonth ?? fallback.bonusDayOfMonth),
    bonusWithSalaryEnd:
      raw?.bonusWithSalaryEnd == null
        ? fallback.bonusWithSalaryEnd
        : Boolean(raw.bonusWithSalaryEnd),
    bonusForPreviousMonth:
      raw?.bonusForPreviousMonth == null
        ? fallback.bonusForPreviousMonth
        : Boolean(raw.bonusForPreviousMonth),
    updatedAt: Number(raw?.updatedAt) || 0,
  };
}

function mapPayrollItem(id: string, data: Record<string, unknown>): PayrollItem {
  const kindRaw = String(data.kind || "");
  const kind: PayrollKind =
    kindRaw === "salary_month_end" ||
    kindRaw === "bonus" ||
    kindRaw === "salary_mid" ||
    kindRaw === "salary_special"
      ? kindRaw
      : "salary_mid";
  const statusRaw = String(data.status || "");
  const status: PayrollStatus =
    statusRaw === "paid" || statusRaw === "void" || statusRaw === "pending"
      ? statusRaw
      : "pending";
  const slipUrls = Array.isArray(data.slipUrls)
    ? data.slipUrls.map(String).filter((u) => u.trim()).slice(0, PAYROLL_SLIP_MAX)
    : [];
  const periodMonth = String(data.periodMonth || "");
  const dueDate = Number(data.dueDate) || 0;
  const storedAccount = Number(data.accountDate) || 0;
  const accountDate =
    storedAccount ||
    resolveAccountDate(periodMonth, dueDate, kindUsesMonthEndAccount(kind));
  const amount = round2(Number(data.amount) || 0);
  const advanceDeduct = round2(Math.max(0, Number(data.advanceDeduct) || 0));
  const grossRaw = Number(data.grossAmount);
  const grossAmount = round2(
    Number.isFinite(grossRaw) && grossRaw > 0 ? grossRaw : amount + advanceDeduct,
  );
  return {
    id,
    employeeId: String(data.employeeId || ""),
    employeeName: String(data.employeeName || ""),
    periodMonth,
    kind,
    dueDate,
    accountDate,
    grossAmount,
    advanceDeduct,
    amount,
    status,
    slipUrls,
    note: typeof data.note === "string" ? data.note : "",
    paidAt: Number(data.paidAt) || 0,
    paidBy: String(data.paidBy || ""),
    ownerBookId: String(data.ownerBookId || ""),
    salaryBase: round2(Number(data.salaryBase) || 0),
    bonusRemaining: round2(Number(data.bonusRemaining) || 0),
    advanceApplied: Boolean(data.advanceApplied),
    createdAt: Number(data.createdAt) || 0,
    updatedAt: Number(data.updatedAt) || Number(data.createdAt) || 0,
    createdBy: String(data.createdBy || ""),
  };
}

export async function getPayrollSchedule(): Promise<PayrollSchedule> {
  const snap = await getDoc(scheduleRef());
  return normalizePayrollSchedule(
    snap.exists() ? (snap.data() as Partial<PayrollSchedule>) : null,
  );
}

export function subscribePayrollSchedule(
  onData: (schedule: PayrollSchedule) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    scheduleRef(),
    (snap) => {
      onData(
        normalizePayrollSchedule(
          snap.exists() ? (snap.data() as Partial<PayrollSchedule>) : null,
        ),
      );
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export async function savePayrollSchedule(
  patch: Partial<PayrollSchedule>,
): Promise<PayrollSchedule> {
  const current = await getPayrollSchedule();
  const next = normalizePayrollSchedule({
    ...current,
    ...patch,
    salarySplits: patch.salarySplits ?? current.salarySplits,
    updatedAt: Date.now(),
  });
  const pctSum = next.salarySplits.reduce((s, x) => s + x.percent, 0);
  if (pctSum <= 0) throw new Error("สัดส่วนเงินเดือนต้องมากกว่า 0");
  await setDoc(scheduleRef(), next, { merge: true });
  return next;
}

export function subscribePayrollItems(
  onData: (items: PayrollItem[]) => void,
  onError?: (err: Error) => void,
  opts?: { since?: number; employeeId?: string },
): Unsubscribe {
  const since = opts?.since;
  const employeeId = (opts?.employeeId || "").trim();
  // พนักงานต้องกรอง employeeId — rules อนุญาต list เฉพาะเมื่อ query จำกัดแค่ของตัวเอง
  let q;
  if (employeeId && since != null) {
    q = query(
      payrollCol(),
      where("employeeId", "==", employeeId),
      where("dueDate", ">=", since),
      orderBy("dueDate", "desc"),
    );
  } else if (employeeId) {
    q = query(
      payrollCol(),
      where("employeeId", "==", employeeId),
      orderBy("dueDate", "desc"),
    );
  } else if (since != null) {
    q = query(payrollCol(), where("dueDate", ">=", since), orderBy("dueDate", "desc"));
  } else {
    q = query(payrollCol(), orderBy("dueDate", "desc"));
  }
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => mapPayrollItem(d.id, d.data() as Record<string, unknown>)));
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export function subscribePendingPayrollItems(
  onData: (items: PayrollItem[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    payrollCol(),
    where("status", "==", "pending"),
    orderBy("dueDate", "asc"),
  );
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => mapPayrollItem(d.id, d.data() as Record<string, unknown>)));
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export function salaryAmountForSplit(monthlySalary: number, percent: number): number {
  return round2((Math.max(0, monthlySalary) * Math.max(0, percent)) / 100);
}

export type BonusAmountByEmployee = Record<string, number>;

export type GeneratePayrollResult = {
  created: number;
  /** รายการที่เคยยกเลิก (void) แล้วเปิดกลับเป็นรอโอน */
  restored: number;
  skipped: number;
  ids: string[];
};

function resolvePeriodAndDue(
  periodMonth: string,
  dayOfMonth: number,
  forPreviousMonth: boolean,
): { periodMonth: string; dueDate: number } {
  // periodMonth ที่ส่งเข้ามา = เดือนที่เจ้าของกำลังเคลียร์ (เดือนอ้างอิงค่าจ้าง)
  // due date: ถ้า forPreviousMonth ของ split หมายความว่าจ่ายหลังสิ้นเดือน → due อยู่เดือนถัดไป
  const { year, monthIndex } = parsePeriodMonth(periodMonth);
  if (forPreviousMonth) {
    const next = new Date(Date.UTC(year, monthIndex + 1, 1));
    return {
      periodMonth,
      dueDate: bangkokNoonMs(next.getUTCFullYear(), next.getUTCMonth(), dayOfMonth),
    };
  }
  return {
    periodMonth,
    dueDate: bangkokNoonMs(year, monthIndex, dayOfMonth),
  };
}

export type PayrollGenerateScope = "salary" | "bonus" | "all";

/**
 * สร้างรายการรอโอนของเดือนอ้างอิง
 * - salary / bonus แยกสร้างได้ (โบนัสควรรอหักนิ่งก่อน)
 * - หักเบิกล่วงหน้าจากยอดโอน (เงินเดือนก่อน แล้วค่อยโบนัส)
 * - งวดสิ้นเดือน+โบนัส: accountDate = สิ้นเดือน (ไม่ใช่วันที่ 1)
 * - เคยยกเลิก (void) → สร้างใหม่/เปิดกลับได้ · pending/paid ไม่ทับ
 */
export async function generatePayrollForPeriod(input: {
  periodMonth: string;
  employees: Employee[];
  bonusByEmployee: BonusAmountByEmployee;
  createdBy: string;
  schedule?: PayrollSchedule;
  /** ค่าเริ่มต้น all — แนะนำแยก salary ก่อน แล้วค่อย bonus หลังล็อกหัก */
  scope?: PayrollGenerateScope;
}): Promise<GeneratePayrollResult> {
  const schedule = input.schedule
    ? normalizePayrollSchedule(input.schedule)
    : await getPayrollSchedule();
  const scope = input.scope || "all";
  const createdBy = input.createdBy.trim();
  if (!createdBy) throw new Error("ไม่พบผู้สร้างรายการ");
  parsePeriodMonth(input.periodMonth);

  const active = input.employees.filter((e) => e.active && !e.skipGroupPayroll);
  const now = Date.now();
  let created = 0;
  let restored = 0;
  let skipped = 0;
  const ids: string[] = [];

  const plans: Array<{
    kind: Exclude<PayrollKind, "salary_special">;
    dayOfMonth: number;
    forPreviousMonth: boolean;
    amountFor: (emp: Employee) => number;
    salaryBase: (emp: Employee) => number;
    bonusRemaining: (emp: Employee) => number;
  }> = [];

  if (scope === "salary" || scope === "all") {
    for (const split of schedule.salarySplits) {
      if (split.percent <= 0) continue;
      plans.push({
        kind: split.kind,
        dayOfMonth: split.dayOfMonth,
        forPreviousMonth: split.forPreviousMonth,
        amountFor: (emp) =>
          salaryAmountForSplit(Number(emp.monthlySalary) || 0, split.percent),
        salaryBase: (emp) => round2(Number(emp.monthlySalary) || 0),
        bonusRemaining: () => 0,
      });
    }
  }

  if (scope === "bonus" || scope === "all") {
    plans.push({
      kind: "bonus",
      dayOfMonth: schedule.bonusDayOfMonth,
      forPreviousMonth: schedule.bonusForPreviousMonth,
      amountFor: (emp) => round2(Math.max(0, Number(input.bonusByEmployee[emp.id]) || 0)),
      salaryBase: () => 0,
      bonusRemaining: (emp) =>
        round2(Math.max(0, Number(input.bonusByEmployee[emp.id]) || 0)),
    });
  }

  if (!plans.length) throw new Error("ไม่มีรอบจ่ายให้สร้าง");

  const db = getDb();
  let batch = writeBatch(db);
  let ops = 0;

  async function flush() {
    if (ops === 0) return;
    await batch.commit();
    batch = writeBatch(db);
    ops = 0;
  }

  // ยอดเบิกที่กันไว้ในรายการรอโอนแล้ว — อย่าหักซ้ำตอนสร้างรอบใหม่
  const reservedAdvance = new Map<string, number>();
  const pendingSnap = await getDocs(query(payrollCol(), where("status", "==", "pending")));
  for (const d of pendingSnap.docs) {
    const row = mapPayrollItem(d.id, d.data() as Record<string, unknown>);
    if (row.advanceDeduct > 0 && !row.advanceApplied) {
      reservedAdvance.set(
        row.employeeId,
        round2((reservedAdvance.get(row.employeeId) || 0) + row.advanceDeduct),
      );
    }
  }

  for (const emp of active) {
    let advanceLeft = round2(
      Math.max(0, (Number(emp.advanceBalance) || 0) - (reservedAdvance.get(emp.id) || 0)),
    );

    for (const plan of plans) {
      const grossAmount = plan.amountFor(emp);
      if (!(grossAmount > 0)) {
        skipped += 1;
        continue;
      }

      const { dueDate } = resolvePeriodAndDue(
        input.periodMonth,
        plan.dayOfMonth,
        plan.forPreviousMonth,
      );
      const accountDate = resolveAccountDate(
        input.periodMonth,
        dueDate,
        plan.forPreviousMonth,
      );
      const id = payrollItemDocId(emp.id, input.periodMonth, plan.kind);
      const ref = doc(db, "payrollItems", id);
      const existing = await getDoc(ref);

      if (existing.exists()) {
        const prev = mapPayrollItem(existing.id, existing.data() as Record<string, unknown>);
        if (prev.status !== "void") {
          skipped += 1;
          continue;
        }
      }

      const advanceDeduct = round2(Math.min(advanceLeft, grossAmount));
      const amount = round2(grossAmount - advanceDeduct);
      advanceLeft = round2(Math.max(0, advanceLeft - advanceDeduct));

      const payload = {
        employeeId: emp.id,
        employeeName: emp.name,
        periodMonth: input.periodMonth,
        kind: plan.kind,
        dueDate,
        accountDate,
        grossAmount,
        advanceDeduct,
        amount,
        status: "pending" as const satisfies PayrollStatus,
        slipUrls: [] as string[],
        note: advanceDeduct > 0 ? `หักเบิก ฿${advanceDeduct.toFixed(2)}` : "",
        paidAt: 0,
        paidBy: "",
        ownerBookId: "",
        salaryBase: plan.salaryBase(emp),
        bonusRemaining: plan.bonusRemaining(emp),
        advanceApplied: false,
        updatedAt: now,
        createdBy,
      };

      if (existing.exists()) {
        const prev = mapPayrollItem(existing.id, existing.data() as Record<string, unknown>);
        batch.set(ref, {
          ...payload,
          createdAt: prev.createdAt || now,
        });
        ops += 1;
        restored += 1;
        ids.push(id);
        if (ops >= 400) await flush();
        continue;
      }

      batch.set(ref, {
        ...payload,
        createdAt: now,
      });
      ops += 1;
      created += 1;
      ids.push(id);
      if (ops >= 400) await flush();
    }
  }
  await flush();
  return { created, restored, skipped, ids };
}

/**
 * สร้างคิวจ่ายแยก ยอดกำหนดเอง (พนักงานใหม่ / แปลงประจำก่อนรอบกลุ่ม)
 * — เข้าคิวรอโอนเหมือนเงินเดือนปกติ · ไม่ทับงวดกลาง/ปลาย
 */
export async function createSpecialPayrollItem(input: {
  employee: Employee;
  periodMonth: string;
  grossAmount: number;
  createdBy: string;
  note?: string;
  /** วันโอน — ค่าเริ่มต้นวันนี้ (ICT) */
  dueDate?: number;
  /** วันลงบัญชี — ค่าเริ่มต้น = dueDate */
  accountDate?: number;
  /** true = ติ๊กข้ามสร้างเงินเดือนกลุ่ม (แนะนำตอนรับใหม่จ่ายแยก) */
  markSkipGroupPayroll?: boolean;
}): Promise<string> {
  const createdBy = input.createdBy.trim();
  if (!createdBy) throw new Error("ไม่พบผู้สร้างรายการ");
  parsePeriodMonth(input.periodMonth);
  const emp = input.employee;
  if (!emp?.id) throw new Error("ไม่พบพนักงาน");
  if (!emp.active) throw new Error("พนักงานนี้ปิดอยู่ — เปิดใช้งานก่อน");
  const grossAmount = round2(Number(input.grossAmount) || 0);
  if (!(grossAmount > 0)) throw new Error("ใส่ยอดจ่ายแยกให้มากกว่า 0");

  const { y, m, d } = bangkokCalendarParts(Date.now());
  const dueDate =
    Number(input.dueDate) > 0
      ? Number(input.dueDate)
      : bangkokNoonMs(y, m - 1, d);
  const accountDate =
    Number(input.accountDate) > 0 ? Number(input.accountDate) : dueDate;
  const note = (input.note || "").trim();

  // หักเบิกค้างที่ยังไม่ถูกกันในคิวรอโอนอื่น
  let reserved = 0;
  const pendingSnap = await getDocs(query(payrollCol(), where("status", "==", "pending")));
  for (const rowDoc of pendingSnap.docs) {
    const row = mapPayrollItem(rowDoc.id, rowDoc.data() as Record<string, unknown>);
    if (row.employeeId === emp.id && row.advanceDeduct > 0 && !row.advanceApplied) {
      reserved = round2(reserved + row.advanceDeduct);
    }
  }
  const advanceLeft = round2(
    Math.max(0, (Number(emp.advanceBalance) || 0) - reserved),
  );
  const advanceDeduct = round2(Math.min(advanceLeft, grossAmount));
  const amount = round2(grossAmount - advanceDeduct);

  const now = Date.now();
  const id = payrollSpecialItemDocId(emp.id, input.periodMonth, now.toString(36));
  const ref = doc(getDb(), "payrollItems", id);
  await setDoc(ref, {
    employeeId: emp.id,
    employeeName: emp.name,
    periodMonth: input.periodMonth,
    kind: "salary_special" satisfies PayrollKind,
    dueDate,
    accountDate,
    grossAmount,
    advanceDeduct,
    amount,
    status: "pending" satisfies PayrollStatus,
    slipUrls: [] as string[],
    note:
      note ||
      (advanceDeduct > 0 ? `หักเบิก ฿${advanceDeduct.toFixed(2)}` : ""),
    paidAt: 0,
    paidBy: "",
    ownerBookId: "",
    salaryBase: round2(Number(emp.monthlySalary) || 0),
    bonusRemaining: 0,
    advanceApplied: false,
    createdAt: now,
    updatedAt: now,
    createdBy,
  });

  if (input.markSkipGroupPayroll) {
    await updateEmployee(emp.id, { skipGroupPayroll: true });
  }

  return id;
}

export function payrollDescription(item: Pick<PayrollItem, "kind" | "periodMonth" | "employeeName">): string {
  const label = PAYROLL_KIND_LABELS[item.kind] || item.kind;
  return `${label} ${item.periodMonth} — ${item.employeeName}`;
}

export async function updatePayrollSlips(
  id: string,
  slipUrls: string[],
): Promise<void> {
  const urls = slipUrls.map((u) => u.trim()).filter(Boolean).slice(0, PAYROLL_SLIP_MAX);
  await updateDoc(doc(getDb(), "payrollItems", id), {
    slipUrls: urls,
    updatedAt: Date.now(),
  });
}

export async function voidPayrollItem(id: string, actorId: string): Promise<void> {
  const ref = doc(getDb(), "payrollItems", id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("ไม่พบรายการ");
  const item = mapPayrollItem(snap.id, snap.data() as Record<string, unknown>);
  if (item.status !== "pending") throw new Error("ยกเลิกได้เฉพาะรายการรอโอน");
  await updateDoc(ref, {
    status: "void" satisfies PayrollStatus,
    paidBy: actorId.trim(),
    paidAt: Date.now(),
    updatedAt: Date.now(),
  });
}

/** กู้คืนรายการที่ยกเลิก (ยังไม่เคยจ่าย) กลับเป็นรอโอน */
export async function restorePayrollItem(id: string): Promise<void> {
  const ref = doc(getDb(), "payrollItems", id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("ไม่พบรายการ");
  const item = mapPayrollItem(snap.id, snap.data() as Record<string, unknown>);
  if (item.status !== "void") throw new Error("กู้คืนได้เฉพาะรายการที่ยกเลิก");
  if (item.ownerBookId) throw new Error("รายการนี้เคยลงบัญชีแล้ว กู้คืนไม่ได้");
  await updateDoc(ref, {
    status: "pending" satisfies PayrollStatus,
    paidAt: 0,
    paidBy: "",
    updatedAt: Date.now(),
  });
}

/**
 * เจ้าของโอนแล้ว — ลงบช.เจ้าของเป็น sga + mark paid
 * ถ้าเป็นโบนัส จะ lock แถวผลิต/ชงของคนนั้นในเดือนอ้างอิง
 */
export async function markPayrollPaid(input: {
  id: string;
  paidBy: string;
  slipUrls?: string[];
  note?: string;
  prodEntries?: ProdEntry[];
  otEntries?: OtEntry[];
}): Promise<string> {
  const paidBy = input.paidBy.trim();
  if (!paidBy) throw new Error("ไม่พบผู้จ่าย");
  const ref = doc(getDb(), "payrollItems", input.id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("ไม่พบรายการ");
  const item = mapPayrollItem(snap.id, snap.data() as Record<string, unknown>);
  if (item.status !== "pending") throw new Error("จ่ายได้เฉพาะรายการรอโอน");
  if (!(item.amount > 0) && !(item.advanceDeduct > 0)) {
    throw new Error("ยอดต้องมากกว่า 0");
  }

  const slipUrls = (input.slipUrls ?? item.slipUrls)
    .map((u) => u.trim())
    .filter(Boolean)
    .slice(0, PAYROLL_SLIP_MAX);
  const note = (input.note ?? item.note).trim();
  const description = payrollDescription(item);
  const bookDate =
    item.accountDate ||
    resolveAccountDate(
      item.periodMonth,
      item.dueDate,
      kindUsesMonthEndAccount(item.kind),
    ) ||
    Date.now();

  // ลงบัญชีตามเงินที่โอนจริง (สุทธิ) — ส่วนหักเบิกเคยลงตอนจ่ายเบิกแล้ว
  // งวดสิ้นเดือนใช้ accountDate = สิ้นเดือน ไม่ใช่วันที่โอน (ม.1)
  if (!(item.amount > 0) && item.advanceDeduct > 0) {
    // เคลียรด้วยการหักเบิกอย่างเดียว ไม่มีเงินโอน — ไม่สร้างแถวเงินออก
    if (!item.advanceApplied) {
      await adjustEmployeeAdvanceBalance(item.employeeId, -item.advanceDeduct);
    }
    await updateDoc(ref, {
      status: "paid" satisfies PayrollStatus,
      slipUrls,
      note,
      paidAt: Date.now(),
      paidBy,
      ownerBookId: "",
      advanceApplied: true,
      accountDate: bookDate,
      updatedAt: Date.now(),
    });
    return "";
  }

  const bookNote = [
    note,
    item.advanceDeduct > 0
      ? `ก่อนหัก ฿${item.grossAmount.toFixed(2)} · หักเบิก ฿${item.advanceDeduct.toFixed(2)}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const ownerBookId = await addOwnerBookEntry({
    date: bookDate,
    description,
    amountOut: item.amount,
    type: "sga",
    typeSource: "payroll",
    typeAiReason:
      item.kind === "bonus"
        ? "โบนัสพนักงาน"
        : item.kind === "salary_special"
          ? "เงินเดือนจ่ายแยก"
          : "เงินเดือนพนักงาน",
    createdBy: paidBy,
    receiptUrls: slipUrls,
    note: bookNote,
  });

  if (item.advanceDeduct > 0 && !item.advanceApplied) {
    await adjustEmployeeAdvanceBalance(item.employeeId, -item.advanceDeduct);
  }

  await updateDoc(ref, {
    status: "paid" satisfies PayrollStatus,
    slipUrls,
    note,
    paidAt: Date.now(),
    paidBy,
    ownerBookId,
    advanceApplied: true,
    accountDate: bookDate,
    updatedAt: Date.now(),
  });

  if (item.kind === "bonus" && input.prodEntries && input.otEntries) {
    await lockBonusSourceEntriesForEmployee(
      item.employeeId,
      item.periodMonth,
      input.prodEntries,
      input.otEntries,
      item.employeeName,
    );
  }

  return ownerBookId;
}

/**
 * บันทึกเบิกล่วงหน้าใหม่ — เพิ่มยอดค้างหัก
 * @param postToBooks ถ้า true ลงบช.เจ้าของเป็นเงินออก (ใช้เมื่อเพิ่งจ่ายเงินสดจริง)
 */
export async function recordEmployeeAdvance(input: {
  employeeId: string;
  employeeName: string;
  amount: number;
  createdBy: string;
  date?: number;
  note?: string;
  postToBooks?: boolean;
}): Promise<{ advanceBalance: number; ownerBookId: string }> {
  const amount = round2(Number(input.amount) || 0);
  if (!(amount > 0)) throw new Error("ยอดเบิกต้องมากกว่า 0");
  const createdBy = input.createdBy.trim();
  if (!createdBy) throw new Error("ไม่พบผู้บันทึก");

  const advanceBalance = await adjustEmployeeAdvanceBalance(input.employeeId, amount);
  let ownerBookId = "";
  if (input.postToBooks) {
    ownerBookId = await addOwnerBookEntry({
      date: input.date || Date.now(),
      description: `เบิกล่วงหน้า — ${input.employeeName}`,
      amountOut: amount,
      type: "sga",
      typeSource: "payroll-advance",
      typeAiReason: "เบิกเงินเดือนล่วงหน้า",
      createdBy,
      note: (input.note || "").trim() || "จะหักจากรอบจ่ายถัดไป",
    });
  }
  return { advanceBalance, ownerBookId };
}

function entryHasEmployee(
  entry: { workerIds?: string[]; workerNames?: string[] },
  employeeId: string,
  employeeName?: string,
  employee?: { name: string; nickname?: string; previousNames?: string[] },
): boolean {
  if ((entry.workerIds || []).includes(employeeId)) return true;
  if (employee) {
    return (entry.workerNames || []).some((n) => employeeMatchesName(employee, n));
  }
  if (employeeName) {
    return (entry.workerNames || []).some((n) => namesMatch(n, employeeName));
  }
  return false;
}

/** Lock แถวผลิต/ชงของพนักงานในเดือนอ้างอิงให้เป็น paid */
export async function lockBonusSourceEntriesForEmployee(
  employeeId: string,
  periodMonth: string,
  prodEntries: ProdEntry[],
  otEntries: OtEntry[],
  employeeName?: string,
): Promise<{ prod: number; ot: number }> {
  const { year, monthIndex } = parsePeriodMonth(periodMonth);

  const prodIds = prodEntries
    .filter(
      (e) =>
        e.status !== "paid" &&
        isInMonth(e.date, year, monthIndex) &&
        entryHasEmployee(e, employeeId, employeeName),
    )
    .map((e) => e.id);

  const otIds = otEntries
    .filter(
      (e) =>
        e.status !== "paid" &&
        isInMonth(e.date, year, monthIndex) &&
        entryHasEmployee(e, employeeId, employeeName),
    )
    .map((e) => e.id);

  const prod = prodIds.length ? await bulkUpdateProdEntryStatus(prodIds, "paid") : 0;
  const ot = otIds.length ? await bulkUpdateOtEntryStatus(otIds, "paid") : 0;
  return { prod, ot };
}

export function summarizePayrollItems(items: PayrollItem[]) {
  const pending = items.filter((i) => i.status === "pending");
  const paid = items.filter((i) => i.status === "paid");
  return {
    pendingCount: pending.length,
    pendingSum: round2(pending.reduce((s, i) => s + i.amount, 0)),
    paidCount: paid.length,
    paidSum: round2(paid.reduce((s, i) => s + i.amount, 0)),
  };
}

/** เดือนอ้างอิงที่ควรเคลียร์ตาม "วันนี้" (วันที่ 1 → เดือนที่แล้ว, อื่นๆ → เดือนปัจจุบัน) */
export function suggestPeriodMonthForToday(ms = Date.now(), schedule?: PayrollSchedule): string {
  const sch = normalizePayrollSchedule(schedule);
  const { y, m, d } = bangkokCalendarParts(ms);
  const current = periodMonthKey(y, m - 1);
  // ถ้าวันนี้เป็นวันจ่ายงวดปลาย/โบนัส (มักวันที่ 1) ให้ชี้ไปเดือนที่แล้ว
  if (d === sch.bonusDayOfMonth || sch.salarySplits.some((s) => s.forPreviousMonth && s.dayOfMonth === d)) {
    return shiftPeriodMonth(current, -1);
  }
  return current;
}

export async function listPayrollItemsOnce(): Promise<PayrollItem[]> {
  const snap = await getDocs(query(payrollCol(), orderBy("dueDate", "desc")));
  return snap.docs.map((d) => mapPayrollItem(d.id, d.data() as Record<string, unknown>));
}
