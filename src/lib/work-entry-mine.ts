/**
 * กรองรายการชง/ผลิต "ของฉัน" — ใช้ร่วมหน้า OT · ผลิต · สรุปโบนัส
 * employeeId ใน workerIds ก่อน แล้วค่อยชื่อ/ชื่อเล่น/ชื่อเก่า/displayName
 */
import { employeeMatchesName, findEmployeeByWorkedName, namesMatch } from "./bonus";
import type { Employee } from "./employees";

export type WorkEntryMineShape = {
  workerIds?: string[];
  workerNames: string[];
  /** staff/{id} ของคนที่บันทึก — fallback เมื่อ workerIds/ชื่อค้าง */
  createdBy?: string;
};

export type WorkEntryMineIdentity = {
  employeeId?: string;
  name?: string;
  displayName?: string;
  nickname?: string;
  previousNames?: string[];
  /** staff/{id} บัญชีที่ล็อกอิน */
  staffId?: string;
};

export function workEntryIncludesName(entry: WorkEntryMineShape, name: string): boolean {
  if (!name.trim()) return false;
  return (entry.workerNames || []).some((w) => namesMatch(w, name));
}

/**
 * แถวนี้นับเข้าโบนัส/ประวัติของพนักงานคนนี้ — logic คู่กับ computeMonthBonus.creditEntryWorkers
 * (id ใน workerIds · ชื่อแมป roster · createdBy สำรอง)
 */
export function workEntryCreditsEmployee(
  entry: WorkEntryMineShape,
  employee: Pick<Employee, "id" | "name" | "nickname" | "previousNames"> | null,
  roster: Employee[] = [],
  staffId?: string,
): boolean {
  if (!employee) return false;
  const sid = (staffId || "").trim();
  if (sid && (entry.createdBy || "").trim() === sid) return true;
  const ids = entry.workerIds || [];
  if (ids.includes(employee.id)) return true;
  const credited = new Set<string>();
  for (const id of ids) {
    const emp = roster.find((e) => e.id === id);
    if (emp?.id === employee.id) {
      credited.add(employee.id);
      return true;
    }
  }
  for (const rawName of entry.workerNames || []) {
    const matched =
      findEmployeeByWorkedName(roster, rawName) ||
      (employeeMatchesName(employee, rawName) ? employee : undefined);
    if (matched?.id === employee.id) return true;
    if (matched) credited.add(matched.id);
  }
  if (ids.length > 0) return false;
  return (entry.workerNames || []).some((n) => employeeMatchesName(employee, n));
}

/** true ถ้ารายการมีคนนี้ — id หรือชื่อใดชื่อหนึ่งตรง */
export function workEntryIncludesMe(
  entry: WorkEntryMineShape,
  me: WorkEntryMineIdentity | null | undefined,
): boolean {
  if (!me) return false;
  const id = (me.employeeId || "").trim();
  const ids = entry.workerIds || [];
  if (id && ids.includes(id)) return true;
  const staffId = (me.staffId || "").trim();
  if (staffId && (entry.createdBy || "").trim() === staffId) return true;
  // id ค้าง/ว่าง — ยังเทียบชื่อในกะ (กันโบนัส/ตารางฝั่งพนักงานเป็น 0 ทั้งที่ลงแล้ว)
  const aliases = [
    me.name,
    me.nickname,
    me.displayName,
    ...(me.previousNames || []),
  ].filter((n): n is string => !!n?.trim());
  if (aliases.some((n) => workEntryIncludesName(entry, n))) return true;
  return false;
}

/** สร้าง identity จากแถว roster + staff — ใช้กรองฝั่ง client */
export function buildWorkEntryMineIdentity(
  linked: {
    id: string;
    name: string;
    nickname?: string;
    previousNames?: string[];
  } | null,
  staff?: {
    employeeId?: string;
    displayName?: string;
    id?: string;
  } | null,
): WorkEntryMineIdentity {
  return {
    employeeId: linked?.id || staff?.employeeId || "",
    name: linked?.name || "",
    nickname: linked?.nickname || "",
    previousNames: linked?.previousNames || [],
    displayName: staff?.displayName || "",
    staffId: staff?.id || "",
  };
}
