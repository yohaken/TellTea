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
  if (id && (entry.workerIds || []).includes(id)) return true;
  const aliases = [
    me.name,
    me.nickname,
    me.displayName,
    ...(me.previousNames || []),
  ].filter((n): n is string => !!n?.trim());
  return aliases.some((n) => workEntryIncludesName(entry, n));
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
