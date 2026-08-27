/**
 * Staff work page readiness contracts — พนักงานโหลด input เดียวกับเจ้าของ แล้วกรองฝั่ง client
 */
import type { BonusDeductionMonthDoc, BonusDeductionSettings } from "./bonus-deductions";
import type { WorkerMonthBonus } from "./bonus";
import type { BonusLivePool } from "./bonus-live-pool";
import type {
  BonusMonthStatusDoc,
  BonusPersonalCloseDoc,
} from "./bonus-personal-close";
import type { Employee } from "./employees";
import type { OtEntry } from "./ot";
import type { ProdEntry, ProdProduct } from "./production";
import type { RateScheduleEntry } from "./rate-schedule";

export type StaffWorkPage = "bonus" | "production";

export type StaffWorkLoadStatus =
  | "loading"
  | "ready"
  | "blocked_link"
  | "blocked_perm"
  | "blocked_network";

export type StaffBonusBundle = {
  linked: Employee;
  employees: Employee[];
  rateSchedule: RateScheduleEntry[];
  deductionSettings: BonusDeductionSettings;
  deductionMonth: BonusDeductionMonthDoc;
  otEntries: OtEntry[];
  prodEntries: ProdEntry[];
  livePool: BonusLivePool | null;
  monthStatus: BonusMonthStatusDoc | null;
  personalClose: BonusPersonalCloseDoc | null;
};

export type StaffProductionBundle = {
  linked: Employee;
  workers: Employee[];
  products: ProdProduct[];
  rateSchedule: RateScheduleEntry[];
  /** ผลิตเดือน — กรองของฉันแล้ว */
  entries: ProdEntry[];
};

export type StaffWorkBundleError = {
  status: StaffWorkLoadStatus;
  message: string;
  source?: string;
};

/** พนักงานโบนัสพร้อมแสดง — เทียบ owner `!report` */
export function isStaffBonusBundleReady(
  bundle: StaffBonusBundle | null,
  personalRow: WorkerMonthBonus | null,
  monthClosed: boolean,
): boolean {
  if (!bundle) return false;
  if (monthClosed) {
    return bundle.personalClose?.status === "closed" || personalRow != null;
  }
  // เดือนเปิด: ครบ input แล้วแสดงได้ (แม้ไม่มีแถวโบนัส = empty จริง)
  return bundle.deductionSettings != null && bundle.deductionMonth != null;
}
