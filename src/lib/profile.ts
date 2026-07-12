import type { StaffMember } from "./types";

const SNOOZE_MS = 24 * 60 * 60 * 1000;

/** ข้อมูลส่วนตัวตามบัตร ปชช. — ชื่อ นามสกุล รูปบัตร */
export function needsPersonalProfileSetup(staff: StaffMember | null | undefined): boolean {
  if (!staff || staff.role === "owner") return false;
  if (staff.personalProfileComplete) return false;
  return (
    !staff.legalFirstName?.trim() ||
    !staff.legalLastName?.trim() ||
    !staff.idCardPhotoUrl?.trim()
  );
}

/** เชื่อมชื่อในรายชื่อร้าน (ผลิต / OT / โบนัส) */
export function needsRosterLink(staff: StaffMember | null | undefined): boolean {
  if (!staff || staff.role === "owner") return false;
  if (staff.profileComplete) return false;
  if (staff.profileSnoozeUntil && staff.profileSnoozeUntil > Date.now()) return false;
  return !staff.employeeId?.trim() || !staff.displayName?.trim();
}

/** @deprecated use needsPersonalProfileSetup or needsRosterLink */
export function needsProfileSetup(staff: StaffMember | null | undefined): boolean {
  return needsPersonalProfileSetup(staff) || needsRosterLink(staff);
}

export function profileSnoozeUntilNow() {
  return Date.now() + SNOOZE_MS;
}

export function personalProfileLabel(staff: StaffMember | null | undefined): string {
  if (!staff) return "";
  if (staff.legalFirstName && staff.legalLastName) {
    return `${staff.legalFirstName} ${staff.legalLastName}`;
  }
  return "";
}

export function profileStatusLabel(staff: StaffMember | null | undefined): string {
  if (!staff) return "";
  if (staff.role === "owner") return staff.displayName || "เจ้าของ";
  const legal = personalProfileLabel(staff);
  if (legal) return legal;
  if (staff.profileComplete && staff.displayName) return staff.displayName;
  return "ยังไม่ตั้งโปรไฟล์";
}
