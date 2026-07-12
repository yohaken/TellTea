import type { StaffMember, StaffRole } from "./types";

export const PERMISSION_KEYS = [
  "ledger",
  "stock",
  "production",
  "otBonus",
  "checklist",
  "ownerBooks",
  "pnl",
  "alerts",
  "transferIn",
  "exportData",
  "staffManage",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export type StaffPermissions = Record<PermissionKey, boolean>;

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  ledger: "บัญชีพนักงาน",
  stock: "สต็อก",
  production: "ผลิต / โบนัสเบเกอรี่",
  otBonus: "โบนัส OT / ชง",
  checklist: "SmartCheck SOP",
  ownerBooks: "บช.เจ้าของ",
  pnl: "สรุปรายเดือน",
  alerts: "แจ้งเตือนยอดต่ำ",
  transferIn: "โอนเข้า",
  exportData: "ส่งออกข้อมูล",
  staffManage: "จัดการพนักงาน",
};

export const DEFAULT_STAFF_PERMISSIONS: StaffPermissions = {
  ledger: true,
  stock: true,
  production: true,
  otBonus: true,
  checklist: true,
  ownerBooks: false,
  pnl: false,
  alerts: false,
  transferIn: false,
  exportData: false,
  staffManage: false,
};

export const OWNER_PERMISSIONS: StaffPermissions = {
  ledger: true,
  stock: true,
  production: true,
  otBonus: true,
  checklist: true,
  ownerBooks: true,
  pnl: true,
  alerts: true,
  transferIn: true,
  exportData: true,
  staffManage: true,
};

export function normalizePermissions(
  input?: Partial<StaffPermissions> | null,
  role: StaffRole = "staff",
): StaffPermissions {
  if (role === "owner") return { ...OWNER_PERMISSIONS };
  return { ...DEFAULT_STAFF_PERMISSIONS, ...(input || {}) };
}

export function resolvePermissions(member: StaffMember | null | undefined): StaffPermissions {
  if (!member) return { ...DEFAULT_STAFF_PERMISSIONS, ledger: false, stock: false };
  return normalizePermissions(member.permissions, member.role);
}

export function can(
  member: StaffMember | null | undefined,
  key: PermissionKey,
): boolean {
  return resolvePermissions(member)[key] === true;
}

export function hasAnyExtraPermission(member: StaffMember | null | undefined): boolean {
  const p = resolvePermissions(member);
  return (
    p.ownerBooks ||
    p.pnl ||
    p.alerts ||
    p.transferIn ||
    p.exportData ||
    p.staffManage
  );
}
