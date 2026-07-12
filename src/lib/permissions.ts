import type { StaffMember, StaffRole } from "./types";

export const PERMISSION_KEYS = [
  "ledger",
  "stock",
  "production",
  "otBonus",
  "checklist",
  "assignTasks",
  "bonus",
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
  stock: "คลังวัตถุดิบ",
  production: "ผลิต / โบนัสเบเกอรี่",
  otBonus: "โบนัสชง",
  checklist: "SmartCheck SOP",
  assignTasks: "งานมอบหมาย",
  bonus: "สรุปโบนัสเดือน",
  ownerBooks: "บช.เจ้าของ",
  pnl: "สรุปรายเดือน",
  alerts: "แจ้งเตือนยอดต่ำ",
  transferIn: "โอนเข้า",
  exportData: "ส่งออกข้อมูล",
  staffManage: "จัดการพนักงาน",
};

/** จัดกลุ่มสิทธิ์ให้เลือกใน UI ศูนย์พนักงาน */
export const PERMISSION_GROUPS: { title: string; hint?: string; keys: PermissionKey[] }[] = [
  {
    title: "หน้าหลัก — ใช้ทุกวัน",
    hint: "แท็บด้านล่าง: บัญชี · ผลิต · ชง · เช็ค · คลัง · โบนัส",
    keys: ["ledger", "stock", "production", "otBonus", "checklist", "bonus"],
  },
  {
    title: "อื่นๆ — เครื่องมือเพิ่ม",
    hint: "แสดงแท็บ อื่นๆ เมื่อเปิดอย่างน้อย 1 สิทธิในกลุ่มนี้",
    keys: ["ownerBooks", "pnl", "alerts", "transferIn", "exportData", "staffManage", "assignTasks"],
  },
];

export const DEFAULT_STAFF_PERMISSIONS: StaffPermissions = {
  ledger: true,
  stock: true,
  production: true,
  otBonus: true,
  checklist: true,
  assignTasks: false,
  bonus: true,
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
  assignTasks: false,
  bonus: true,
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
