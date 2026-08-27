import type { StaffMember } from "./types";
import { getIdCardPhotoUrls } from "./staff-personal";

const SNOOZE_MS = 24 * 60 * 60 * 1000;

/** ข้อมูลส่วนตัวตามบัตร ปชช. — ชื่อ นามสกุล รูปบัตร */
export function needsPersonalProfileSetup(staff: StaffMember | null | undefined): boolean {
  if (!staff || staff.role === "owner") return false;
  if (staff.personalProfileComplete) return false;
  const p = staff.personal;
  if (p?.legalFirstName && p?.legalLastName && getIdCardPhotoUrls(p).length) return false;
  return true;
}

/** เชื่อมชื่อในรายชื่อร้าน (ผลิต / ชง / โบนัส) */
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

/** กันชื่อจริงที่กรอกเป็นเบอร์/เลขบัตร — โชว์ displayName แทน */
export function isPlausiblePersonName(name: string): boolean {
  const t = name.trim();
  if (!t || t.length < 2) return false;
  const compact = t.replace(/\s/g, "");
  if (/^\+?\d{9,}$/.test(compact)) return false;
  const digits = (compact.match(/\d/g) || []).length;
  if (digits >= 8 || digits / compact.length > 0.5) return false;
  return true;
}

export function personalProfileLabel(staff: StaffMember | null | undefined): string {
  if (!staff) return "";
  const p = staff.personal;
  const first = (p?.legalFirstName || "").trim();
  const last = (p?.legalLastName || "").trim();
  if (first && last && isPlausiblePersonName(first) && isPlausiblePersonName(last)) {
    return `${first} ${last}`;
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
