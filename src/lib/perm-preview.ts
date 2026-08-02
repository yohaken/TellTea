import {
  materializePermissions,
  resolveEffectivePermissions,
  type StaffPermissions,
} from "./permissions";
import type { PermissionLevel, StaffMember } from "./types";
import { staffAccountLabel } from "./utils";

export const PERM_PREVIEW_STORAGE_KEY = "telltea_perm_preview_v1";

export type PermPreviewState = {
  label: string;
  permissions: StaffPermissions;
  levelId?: string;
  /** staff/{id} ของคนที่สวมมุมมอง */
  memberId?: string;
  /** employees/{id} — ให้โบนัส/จ่าย รู้ว่าเป็น "ฉัน" คนไหน */
  employeeId?: string;
};

export type PermPreviewStartInput = {
  label: string;
  permissions: Partial<StaffPermissions> | null | undefined;
  levelId?: string;
  memberId?: string;
  employeeId?: string;
};

/** เช็คลิสต์ตรวจรับมุมมองพนักงาน (owner) */
export const PERM_PREVIEW_CHECKLIST = [
  "แตะไอคอนพนักงานมุมขวาบน → ดูในมุมพนักงานคนนี้",
  "แท็บล่างตามลำดับสิทธิ์ของคนนั้น (พนักงานร้านไม่มีบัญชี/คลัง)",
  "ไอคอนคนนั้นใหญ่ขึ้น สีเขียวธีม",
  "เปิดหน้าที่ไม่มีสิทธิ์แล้วถูกเด้งออก",
  "VAT / เมนู / settings / โปรไฟล์ / ศูนย์พนักงาน ไม่โชว์ตอนพรีวิว",
  "จ่าย/โบนัส = มุมของคนนั้น (ไม่โชว์จ่ายทั้งร้าน·ปิดเดือน)",
  "แท็บงาน = งานของคนนั้น + แจ้งเบา/หนัก",
  "โมดูลที่เปิด = ดูได้อย่างเดียว ไม่บันทึกจริง",
  "กดออกจากมุมมอง (แถบหรือเมนูไอคอน) กลับเจ้าของ",
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
      permissions: materializePermissions(data.permissions),
      levelId: typeof data.levelId === "string" ? data.levelId : undefined,
      memberId: typeof data.memberId === "string" ? data.memberId : undefined,
      employeeId: typeof data.employeeId === "string" ? data.employeeId : undefined,
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
    permissions: materializePermissions(level.permissions),
    levelId: level.id,
  };
}

/**
 * สร้างพรีวิวจากบัญชีพนักงาน — resolve ผ่าน level เหมือนของจริง
 * (ต้องส่ง levels จากแคตตาล็อกล่าสุด)
 */
export function previewFromMember(
  member: StaffMember,
  labelOverride?: string,
  levels?: PermissionLevel[] | null,
): PermPreviewState {
  return {
    label: (labelOverride || staffAccountLabel(member) || member.displayName || member.id).trim(),
    permissions: resolveEffectivePermissions(member, levels),
    levelId: member.permissionLevelId,
    memberId: member.id,
    employeeId: member.employeeId,
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
    permissions: materializePermissions(preview.permissions),
    permissionLevelId: preview.levelId,
    permissionsCustomized: false,
    profileComplete: true,
    personalProfileComplete: true,
    createdAt: real.createdAt,
    employeeId: preview.employeeId || undefined,
  };
}

export function normalizePreviewInput(input: PermPreviewStartInput): PermPreviewState {
  return {
    label: input.label.trim() || "พรีวิว",
    permissions: materializePermissions(input.permissions),
    levelId: input.levelId,
    memberId: input.memberId,
    employeeId: input.employeeId,
  };
}
