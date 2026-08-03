import type { PermissionLevel, StaffMember, StaffRole } from "./types";

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
  assignTasks: "กระดานโนต (เลิกใช้สิทธิ์แยก — แท็บงานเปิดให้ทุกคนที่ล็อกอิน)",
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
    hint: "แท็บด้านล่างตามที่เปิด: ผลิต · ชง · เช็ค · จ่าย · (บัญชี/คลังถ้าเปิด)",
    keys: ["ledger", "stock", "production", "otBonus", "checklist", "bonus"],
  },
  {
    title: "อื่นๆ — เครื่องมือเพิ่ม",
    hint: "แสดงแท็บ อื่นๆ เมื่อเปิดอย่างน้อย 1 สิทธิในกลุ่มนี้",
    keys: ["ownerBooks", "pnl", "transferIn", "exportData", "staffManage", "payrollPay"],
  },
];

/** ปิดหมด — ใช้ตอน materialize แผนที่สิทธิ์ (deny-by-default) */
export const EMPTY_STAFF_PERMISSIONS: StaffPermissions = {
  ledger: false,
  stock: false,
  production: false,
  otBonus: false,
  checklist: false,
  assignTasks: false,
  bonus: false,
  ownerBooks: false,
  pnl: false,
  transferIn: false,
  exportData: false,
  staffManage: false,
  payrollPay: false,
};

/**
 * แม่แบบพนักงานร้าน (พื้นร้าน) — ไม่เปิดบช./คลังโดยค่าเริ่ม
 * ใช้เฉพาะตอนสร้างใหม่ / seed ลำดับ · ไม่ใช้เติมรูในแผนที่ที่บันทึกแล้ว
 */
export const DEFAULT_STAFF_PERMISSIONS: StaffPermissions = {
  ledger: false,
  stock: false,
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

/** หัวหน้ากะ — เปิดบัญชี+คลังเพิ่มจากพื้นร้าน */
export const SHIFT_LEAD_PERMISSIONS: StaffPermissions = {
  ...DEFAULT_STAFF_PERMISSIONS,
  ledger: true,
  stock: true,
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

/**
 * แผนที่สิทธิ์ชัดเจน: คีย์ที่ไม่มีใน input = ปิด (deny)
 * ห้ามเติมจาก DEFAULT — กันสิทธิ์ค้างจากของเก่า/แผนที่ครึ่งใบ
 */
export function materializePermissions(
  input?: Partial<StaffPermissions> | null,
): StaffPermissions {
  const out: StaffPermissions = { ...EMPTY_STAFF_PERMISSIONS };
  if (!input) return out;
  for (const key of PERMISSION_KEYS) {
    if (typeof input[key] === "boolean") out[key] = input[key]!;
  }
  return out;
}

/**
 * ทำให้เป็น StaffPermissions ครบคีย์
 * - owner → ชุดเจ้าของ
 * - input ว่าง/null → แม่แบบพนักงานร้าน (สร้างใหม่)
 * - มี object → materialize (missing = false)
 */
export function normalizePermissions(
  input?: Partial<StaffPermissions> | null,
  role: StaffRole = "staff",
): StaffPermissions {
  if (role === "owner") return { ...OWNER_PERMISSIONS };
  if (input == null) return { ...DEFAULT_STAFF_PERMISSIONS };
  return materializePermissions(input);
}

/** ตัดสิทธิ์ระดับเจ้าของออก — ใช้ตอนคนที่ไม่ใช่เจ้าของบันทึกสิทธิ์พนักงาน */
export function clampPermissionsForNonOwner(
  input?: Partial<StaffPermissions> | null,
): StaffPermissions {
  const base = materializePermissions(input);
  for (const key of ELEVATED_PERMISSION_KEYS) {
    base[key] = false;
  }
  return base;
}

/**
 * แหล่งความจริงของสิทธิ์พนักงาน
 * 1) owner → เต็ม
 * 2) ผูก level และยังไม่ customize → ใช้ permissions ของ level
 * 3) customize / ไม่มี level ในแคตตาล็อก → แผนที่บน staff (deny missing)
 * 4) ไม่มีแผนที่และไม่เจอ level → แม่แบบพนักงานร้าน
 */
export function resolveEffectivePermissions(
  member: StaffMember | null | undefined,
  levels?: PermissionLevel[] | null,
): StaffPermissions {
  if (!member) return { ...EMPTY_STAFF_PERMISSIONS };
  if (member.role === "owner") return { ...OWNER_PERMISSIONS };

  const levelId = (member.permissionLevelId || "").trim();
  const customized = member.permissionsCustomized === true;

  if (!customized && levelId && levels?.length) {
    const level = levels.find((l) => l.id === levelId);
    if (level && level.active !== false) {
      return materializePermissions(level.permissions);
    }
  }

  if (member.permissions && typeof member.permissions === "object") {
    return materializePermissions(member.permissions);
  }

  if (!customized && levelId && levels?.length) {
    // level ถูกปิด/หาย — ปิดสิทธิ์ดีกว่าเดา
    return { ...EMPTY_STAFF_PERMISSIONS };
  }

  return { ...DEFAULT_STAFF_PERMISSIONS };
}

/** @deprecated ใช้ resolveEffectivePermissions(member, levels) — คงไว้ให้ค่อยๆ ย้าย */
export function resolvePermissions(member: StaffMember | null | undefined): StaffPermissions {
  return resolveEffectivePermissions(member, null);
}

/**
 * ติด permissions ที่ resolve แล้วบน staff — ให้ can()/nav ใช้ค่าเดียวทั้งแอป
 * (levels ว่าง = ใช้แผนที่บนสมาชิก / แม่แบบ ไม่เดา level)
 */
export function withResolvedPermissions(
  member: StaffMember | null | undefined,
  levels?: PermissionLevel[] | null,
): StaffMember | null {
  if (!member) return null;
  return {
    ...member,
    permissions: resolveEffectivePermissions(member, levels),
  };
}

export function can(
  member: StaffMember | null | undefined,
  key: PermissionKey,
): boolean {
  // member.permissions ควรเป็นค่าที่ resolve แล้วจาก auth; ถ้ายังไม่ ก็ materialize แผนที่บนตัว
  if (!member) return false;
  if (member.role === "owner") return true;
  const perms = member.permissions
    ? materializePermissions(member.permissions)
    : resolveEffectivePermissions(member, null);
  return perms[key] === true;
}

export function hasAnyExtraPermission(member: StaffMember | null | undefined): boolean {
  if (!member) return false;
  if (member.role === "owner") return true;
  const p = member.permissions
    ? materializePermissions(member.permissions)
    : resolveEffectivePermissions(member, null);
  return (
    p.ownerBooks ||
    p.pnl ||
    p.transferIn ||
    p.exportData ||
    p.staffManage ||
    p.payrollPay
  );
}

export function permissionsEqual(a: StaffPermissions, b: StaffPermissions): boolean {
  return PERMISSION_KEYS.every((k) => a[k] === b[k]);
}
