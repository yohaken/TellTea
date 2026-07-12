import type { StaffMember } from "./types";

const SNOOZE_MS = 24 * 60 * 60 * 1000;

/** พนักงาน (ไม่ใช่เจ้าของ) ยังไม่ได้เชื่อมชื่อกับรายชื่อร้าน */
export function needsProfileSetup(staff: StaffMember | null | undefined): boolean {
  if (!staff || staff.role === "owner") return false;
  if (staff.profileComplete) return false;
  if (staff.profileSnoozeUntil && staff.profileSnoozeUntil > Date.now()) return false;
  return !staff.employeeId?.trim() || !staff.displayName?.trim();
}

export function profileSnoozeUntilNow() {
  return Date.now() + SNOOZE_MS;
}

export function profileStatusLabel(staff: StaffMember | null | undefined): string {
  if (!staff) return "";
  if (staff.role === "owner") return staff.displayName || "เจ้าของ";
  if (staff.profileComplete && staff.displayName) return staff.displayName;
  return "ยังไม่ตั้งโปรไฟล์";
}
