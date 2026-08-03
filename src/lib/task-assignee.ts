/**
 * ผูก assignee ของงานมอบหมายกับบัญชี staff ให้แน่น
 * — resolve จาก roster + ซ่อม staff.employeeId เมื่อค้างว่าง/ผิดจากลิงก์จริง
 */
import {
  listActiveEmployees,
  resolveTaskAssigneeId,
  type Employee,
} from "./employees";
import { updateStaffProfile } from "./staff";
import type { StaffMember } from "./types";

export type TaskAssigneeResolution = {
  employeeId: string;
  employees: Employee[];
  /** true เมื่อเขียน staff.employeeId ให้ตรงลิงก์แล้ว */
  healed: boolean;
};

/**
 * โหลดรายชื่อ → หา assigneeId → ถ้า staff.employeeId ว่าง/ไม่ตรงลิงก์ ให้เขียนซ่อม
 * (พนักงานอัปเดต employeeId ของตัวเองได้ตาม staffSelfProfileUpdate)
 */
export async function resolveAndHealTaskAssignee(
  staff: Pick<StaffMember, "id" | "email" | "phone" | "displayName" | "employeeId"> | null | undefined,
  opts?: { heal?: boolean },
): Promise<TaskAssigneeResolution> {
  const employees = await listActiveEmployees();
  const employeeId = resolveTaskAssigneeId(employees, staff);
  if (!employeeId || !staff?.id || opts?.heal === false) {
    return { employeeId, employees, healed: false };
  }
  if (staff.employeeId === employeeId) {
    return { employeeId, employees, healed: false };
  }
  try {
    await updateStaffProfile(staff.id, {
      employeeId,
      profileComplete: true,
    });
    return { employeeId, employees, healed: true };
  } catch {
    // อ่านงานด้วย id ที่ resolve ได้ต่อไป — rules รองรับลิงก์ canonical แล้ว
    return { employeeId, employees, healed: false };
  }
}
