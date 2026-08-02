import {
  normalizePermissions,
  type StaffPermissions,
} from "./permissions";
import type { PermissionLevel, StaffMember } from "./types";
import { staffAccountLabel } from "./utils";

export const PERM_PREVIEW_STORAGE_KEY = "telltea_perm_preview_v1";

export type PermPreviewState = {
  label: string;
  permissions: StaffPermissions;
  levelId?: string;
  memberId?: string;
};

export type PermPreviewStartInput = {
  label: string;
  permissions: Partial<StaffPermissions> | null | undefined;
  levelId?: string;
  memberId?: string;
};

/** เช็คลิสต์ตรวจรับมุมมองพนักงาน (owner) */
export const PERM_PREVIEW_CHECKLIST = [
  "เปิดพรีวิวจากลำดับ หรือจากบัญชีพนักงาน",
  "แท็บล่างเหลือเฉพาะหน้าที่ลำดับนั้นมีสิทธิ์",
  "หน้า อื่นๆ โชว์เฉพาะเครื่องมือที่เปิดสิทธิ์",
  "เปิด deep link หน้าที่ไม่มีสิทธิ์แล้วถูกเด้งออก",
  "VAT / เมนู / settings ไม่โชว์ตอนพรีวิว",
  "แถบพรีวิวเห็นชัด + กดออกแล้วกลับมุมเจ้าของ",
  "ไม่บันทึกรายการจริงตอนพรีวิว (ดูอย่างเดียว)",
] as const;

export function loadPermPreview(): PermPreviewState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PERM_PREVIEW_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<PermPreviewState>;
    if (!data || typeof data.label !== "string" || !data.label.trim()) return null;
    return {
      label: data.label.trim(),
      permissions: normalizePermissions(data.permissions, "staff"),
      levelId: typeof data.levelId === "string" ? data.levelId : undefined,
      memberId: typeof data.memberId === "string" ? data.memberId : undefined,
    };
  } catch {
    return null;
  }
}

export function savePermPreview(state: PermPreviewState | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!state) {
      window.sessionStorage.removeItem(PERM_PREVIEW_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(PERM_PREVIEW_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota / private mode */
  }
}

export function previewFromLevel(level: PermissionLevel): PermPreviewState {
  return {
    label: level.name,
    permissions: normalizePermissions(level.permissions, "staff"),
    levelId: level.id,
  };
}

export function previewFromMember(member: StaffMember): PermPreviewState {
  return {
    label: staffAccountLabel(member) || member.displayName || member.id,
    permissions: normalizePermissions(member.permissions, member.role),
    levelId: member.permissionLevelId,
    memberId: member.id,
  };
}

export function buildPreviewStaff(
  real: StaffMember,
  preview: PermPreviewState,
): StaffMember {
  return {
    id: real.id,
    email: real.email,
    phone: real.phone,
    role: "staff",
    displayName: preview.label,
    permissions: normalizePermissions(preview.permissions, "staff"),
    permissionLevelId: preview.levelId,
    permissionsCustomized: false,
    profileComplete: true,
    personalProfileComplete: true,
    createdAt: real.createdAt,
    employeeId: preview.memberId ? real.employeeId : undefined,
  };
}

export function normalizePreviewInput(input: PermPreviewStartInput): PermPreviewState {
  return {
    label: input.label.trim() || "พรีวิว",
    permissions: normalizePermissions(input.permissions, "staff"),
    levelId: input.levelId,
    memberId: input.memberId,
  };
}
