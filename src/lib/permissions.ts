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
  "transferIn",
  "exportData",
  "staffManage",
  "payrollPay",
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
  bonus: "จ่าย / โบนัส",
  ownerBooks: "บช.เจ้าของ",
  pnl: "สรุปรายเดือน",
  transferIn: "โอนเข้า",
  exportData: "ส่งออกข้อมูล",
  staffManage: "จัดการพนักงาน",
  payrollPay: "จ่ายเงินเดือนทั้งร้าน",
};

/** สิทธิ์ระดับเจ้าของ — คนมี staffManage ธรรมดามอบให้คนอื่นไม่ได้ */
export const ELEVATED_PERMISSION_KEYS: PermissionKey[] = [
  "ownerBooks",
  "pnl",
  "transferIn",
  "exportData",
  "staffManage",
  "payrollPay",
];

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
    keys: ["ownerBooks", "pnl", "transferIn", "exportData", "staffManage", "payrollPay", "assignTasks"],
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
  transferIn: false,
  exportData: false,
  staffManage: false,
  payrollPay: false,
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
  transferIn: true,
  exportData: true,
  staffManage: true,
  payrollPay: true,
};

export function normalizePermissions(
  input?: Partial<StaffPermissions> | null,
  role: StaffRole = "staff",
): StaffPermissions {
  if (role === "owner") return { ...OWNER_PERMISSIONS };
  const base = { ...DEFAULT_STAFF_PERMISSIONS };
  if (!input) return base;
  for (const key of PERMISSION_KEYS) {
    if (typeof input[key] === "boolean") base[key] = input[key]!;
  }
  return base;
}

/** ตัดสิทธิ์ระดับเจ้าของออก — ใช้ตอนคนที่ไม่ใช่เจ้าของบันทึกสิทธิ์พนักงาน */
export function clampPermissionsForNonOwner(
  input?: Partial<StaffPermissions> | null,
): StaffPermissions {
  const base = normalizePermissions(input, "staff");
  for (const key of ELEVATED_PERMISSION_KEYS) {
    base[key] = false;
  }
  return base;
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
    p.transferIn ||
    p.exportData ||
    p.staffManage ||
    p.payrollPay
  );
}
