/**
 * กรองรายการชง/ผลิต "ของฉัน" — ใช้ร่วมหน้า OT · ผลิต · สรุปโบนัส
 * employeeId ใน workerIds ก่อน แล้วค่อยชื่อ/ชื่อเล่น/ชื่อเก่า/displayName
 */
import { namesMatch } from "./bonus";

export type WorkEntryMineShape = {
  workerIds?: string[];
  workerNames: string[];
};

export type WorkEntryMineIdentity = {
  employeeId?: string;
  name?: string;
  displayName?: string;
  nickname?: string;
  previousNames?: string[];
};

export function workEntryIncludesName(entry: WorkEntryMineShape, name: string): boolean {
  if (!name.trim()) return false;
  return (entry.workerNames || []).some((w) => namesMatch(w, name));
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
  } | null,
): WorkEntryMineIdentity {
  return {
    employeeId: linked?.id || staff?.employeeId || "",
    name: linked?.name || "",
    nickname: linked?.nickname || "",
    previousNames: linked?.previousNames || [],
    displayName: staff?.displayName || "",
  };
}
