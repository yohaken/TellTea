import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
  type Unsubscribe,
  onSnapshot,
} from "firebase/firestore";
import { getDb } from "./firebase";
import {
  DEFAULT_STAFF_PERMISSIONS,
  ELEVATED_PERMISSION_KEYS,
  OWNER_PERMISSIONS,
  SHIFT_LEAD_PERMISSIONS,
  clampPermissionsForNonOwner,
  materializePermissions,
  normalizePermissions,
  permissionsEqual,
  type StaffPermissions,
} from "./permissions";
import type { PermissionLevel } from "./types";
import { listStaff, updateStaffPermissions } from "./staff";

export const PERMISSION_LEVELS_COLLECTION = "permissionLevels";

/** รหัส seed มาตรฐาน — ใช้เป็น doc id คงที่ */
export const SEED_LEVEL_IDS = {
  shopStaff: "shop_staff",
  shiftLead: "shift_lead",
  ownerAssist: "owner_assist",
  owner: "owner",
} as const;

export type SeedLevelId = (typeof SEED_LEVEL_IDS)[keyof typeof SEED_LEVEL_IDS];

const OWNER_ASSIST_PERMISSIONS: StaffPermissions = {
  ...SHIFT_LEAD_PERMISSIONS,
  ownerBooks: true,
  pnl: true,
  transferIn: true,
  exportData: true,
  staffManage: true,
  payrollPay: true,
  membersView: true,
  membersManage: true,
  membersAdjustPoints: true,
};

/**
 * Seed มาตรฐาน
 * - พนักงานร้าน: พื้นร้าน (ไม่มีบช./คลัง)
 * - หัวหน้ากะ: +บัญชี +คลัง
 * - ผู้ช่วยเจ้าของ: เครื่องมือหลังร้าน
 * - เจ้าของ: เต็ม
 */
export const SEED_PERMISSION_LEVELS: Omit<PermissionLevel, "createdAt" | "updatedAt">[] = [
  {
    id: SEED_LEVEL_IDS.shopStaff,
    name: "พนักงานร้าน",
    sortOrder: 10,
    active: true,
    isSystem: true,
    permissions: { ...DEFAULT_STAFF_PERMISSIONS },
  },
  {
    id: SEED_LEVEL_IDS.shiftLead,
    name: "หัวหน้ากะ",
    sortOrder: 20,
    active: true,
    isSystem: false,
    permissions: { ...SHIFT_LEAD_PERMISSIONS },
  },
  {
    id: SEED_LEVEL_IDS.ownerAssist,
    name: "ผู้ช่วยเจ้าของ",
    sortOrder: 30,
    active: true,
    isSystem: false,
    permissions: { ...OWNER_ASSIST_PERMISSIONS },
  },
  {
    id: SEED_LEVEL_IDS.owner,
    name: "เจ้าของ",
    sortOrder: 100,
    active: true,
    isSystem: true,
    permissions: { ...OWNER_PERMISSIONS },
  },
];

function levelsCol() {
  return collection(getDb(), PERMISSION_LEVELS_COLLECTION);
}

function levelRef(id: string) {
  return doc(getDb(), PERMISSION_LEVELS_COLLECTION, id);
}

function mapLevel(id: string, data: Record<string, unknown>): PermissionLevel {
  const isOwnerLevel = id === SEED_LEVEL_IDS.owner;
  return {
    id,
    name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : id,
    sortOrder: typeof data.sortOrder === "number" ? data.sortOrder : 50,
    active: data.active !== false,
    isSystem: data.isSystem === true,
    permissions: isOwnerLevel
      ? { ...OWNER_PERMISSIONS }
      : materializePermissions(data.permissions as Partial<StaffPermissions> | undefined),
    createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
  };
}

export function levelHasElevated(permissions: Partial<StaffPermissions> | null | undefined): boolean {
  const p = normalizePermissions(permissions, "staff");
  return ELEVATED_PERMISSION_KEYS.some((key) => p[key]);
}

export function isOwnerSystemLevel(level: Pick<PermissionLevel, "id" | "isSystem">): boolean {
  return level.id === SEED_LEVEL_IDS.owner || (level.isSystem && level.id === "owner");
}

/** ลำดับที่เลือกผูกบัญชีพนักงานได้ (ไม่รวมเจ้าของระบบ) */
export function assignableLevels(levels: PermissionLevel[]): PermissionLevel[] {
  return levels
    .filter((l) => l.active && !isOwnerSystemLevel(l))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "th"));
}

export function defaultAssignableLevelId(levels: PermissionLevel[]): string {
  const assignable = assignableLevels(levels);
  const shop = assignable.find((l) => l.id === SEED_LEVEL_IDS.shopStaff);
  return shop?.id || assignable[0]?.id || "";
}

export function findLevel(
  levels: PermissionLevel[],
  levelId?: string | null,
): PermissionLevel | undefined {
  if (!levelId) return undefined;
  return levels.find((l) => l.id === levelId);
}

export function summarizeLevelPermissions(perms: StaffPermissions, hideElevated = false): string {
  const labels: string[] = [];
  const daily = ["ledger", "stock", "production", "otBonus", "checklist", "bonus"] as const;
  const dailyOn = daily.filter((k) => perms[k]).length;
  if (dailyOn) labels.push(`หน้าหลัก ${dailyOn}/6`);
  if (!hideElevated) {
    const elevOn = ELEVATED_PERMISSION_KEYS.filter((k) => perms[k]).length;
    if (elevOn) labels.push(`พิเศษ ${elevOn}`);
  }
  return labels.join(" · ") || "ไม่มีสิทธิ์";
}

export async function listPermissionLevels(): Promise<PermissionLevel[]> {
  const snap = await getDocs(query(levelsCol(), orderBy("sortOrder", "asc")));
  return snap.docs.map((d) => mapLevel(d.id, d.data() as Record<string, unknown>));
}

export function subscribePermissionLevels(
  onData: (levels: PermissionLevel[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(levelsCol(), orderBy("sortOrder", "asc")),
    (snap) => {
      onData(snap.docs.map((d) => mapLevel(d.id, d.data() as Record<string, unknown>)));
    },
    (err) => onError?.(err),
  );
}

/**
 * สร้าง/ซ่อม seed
 * - ลำดับระบบ (shop_staff / owner): merge permissions จากโค้ดเสมอ + sync คนที่ผูกและยังไม่ customize
 * - ลำดับอื่น: สร้างเฉพาะตอนยังไม่มี (ไม่ทับของที่ร้านแก้เอง)
 */
export async function ensurePermissionLevelSeeds(): Promise<PermissionLevel[]> {
  const existing = await listPermissionLevels();
  const byId = new Map(existing.map((l) => [l.id, l]));
  const now = Date.now();
  for (const seed of SEED_PERMISSION_LEVELS) {
    const prev = byId.get(seed.id);
    try {
      if (!prev) {
        await setDoc(levelRef(seed.id), {
          name: seed.name,
          sortOrder: seed.sortOrder,
          active: seed.active,
          isSystem: seed.isSystem,
          permissions: seed.permissions,
          createdAt: now,
          updatedAt: now,
        });
        continue;
      }
      if (!seed.isSystem) continue;
      const nextPerms = materializePermissions(seed.permissions);
      const prevPerms = materializePermissions(prev.permissions);
      if (permissionsEqual(prevPerms, nextPerms) && prev.isSystem) continue;
      await setDoc(
        levelRef(seed.id),
        {
          name: seed.name,
          sortOrder: seed.sortOrder,
          active: seed.active,
          isSystem: true,
          permissions: nextPerms,
          updatedAt: now,
        },
        { merge: true },
      );
      await syncLevelPermissionsToLinkedStaff(seed.id, nextPerms);
    } catch {
      /* permission-denied / offline — ข้าม seed ที่เขียนไม่ได้ */
    }
  }
  try {
    await bindOrphanStaffToShopStaff();
  } catch {
    /* best-effort */
  }
  return listPermissionLevels();
}

/** พนักงานที่ยังไม่ผูกลำดับและไม่ customize → ผูก shop_staff + เขียนแผนที่พื้นร้าน */
export async function bindOrphanStaffToShopStaff(): Promise<number> {
  const staffList = await listStaff();
  const orphans = staffList.filter(
    (m) =>
      m.role === "staff" &&
      !m.permissionLevelId &&
      !m.permissionsCustomized,
  );
  if (!orphans.length) return 0;
  const next = materializePermissions(DEFAULT_STAFF_PERMISSIONS);
  await Promise.all(
    orphans.map((m) =>
      updateStaffPermissions(m.id, next, {
        permissionLevelId: SEED_LEVEL_IDS.shopStaff,
        permissionsCustomized: false,
      }),
    ),
  );
  return orphans.length;
}

/** เขียนสิทธิ์จากลำดับลง staff ที่ผูกและยังไม่ customize */
export async function syncLevelPermissionsToLinkedStaff(
  levelId: string,
  permissions: StaffPermissions,
): Promise<number> {
  const next = materializePermissions(permissions);
  const staffList = await listStaff();
  const targets = staffList.filter(
    (m) =>
      m.role === "staff" &&
      m.permissionLevelId === levelId &&
      !m.permissionsCustomized,
  );
  await Promise.all(
    targets.map((m) =>
      updateStaffPermissions(m.id, next, {
        permissionLevelId: levelId,
        permissionsCustomized: false,
      }),
    ),
  );
  return targets.length;
}

export type PermissionLevelInput = {
  name: string;
  sortOrder?: number;
  active?: boolean;
  permissions: StaffPermissions;
};

function slugifyLevelId(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_\u0e00-\u0e7f]/g, "")
    .slice(0, 40);
  return base || `level_${Date.now().toString(36)}`;
}

export async function createPermissionLevel(
  input: PermissionLevelInput,
  opts?: { asOwner?: boolean; id?: string },
): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new Error("ใส่ชื่อลำดับสิทธิ์");
  let permissions = normalizePermissions(input.permissions, "staff");
  if (!opts?.asOwner) permissions = clampPermissionsForNonOwner(permissions);

  const id = opts?.id || slugifyLevelId(name);
  const ref = levelRef(id);
  const existing = await getDoc(ref);
  if (existing.exists()) throw new Error("มีลำดับสิทธิ์รหัสนี้อยู่แล้ว — เปลี่ยนชื่อหรือแก้รายการเดิม");

  const now = Date.now();
  const sortOrder =
    typeof input.sortOrder === "number" && Number.isFinite(input.sortOrder)
      ? input.sortOrder
      : 40;
  await setDoc(ref, {
    name,
    sortOrder,
    active: input.active !== false,
    isSystem: false,
    permissions,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function updatePermissionLevel(
  id: string,
  input: Partial<PermissionLevelInput> & { syncLinkedStaff?: boolean },
  opts?: { asOwner?: boolean },
): Promise<void> {
  const snap = await getDoc(levelRef(id));
  if (!snap.exists()) throw new Error("ไม่พบลำดับสิทธิ์");
  const before = mapLevel(id, snap.data() as Record<string, unknown>);
  if (isOwnerSystemLevel(before)) {
    throw new Error("ลำดับเจ้าของเป็นของระบบ แก้ชุดสิทธิ์ไม่ได้");
  }

  const patch: Record<string, unknown> = { updatedAt: Date.now() };
  if (typeof input.name === "string") {
    const name = input.name.trim();
    if (!name) throw new Error("ใส่ชื่อลำดับสิทธิ์");
    patch.name = name;
  }
  if (typeof input.sortOrder === "number" && Number.isFinite(input.sortOrder)) {
    patch.sortOrder = input.sortOrder;
  }
  if (typeof input.active === "boolean") patch.active = input.active;
  if (input.permissions) {
    let permissions = normalizePermissions(input.permissions, "staff");
    if (!opts?.asOwner) permissions = clampPermissionsForNonOwner(permissions);
    patch.permissions = permissions;
  }

  await updateDoc(levelRef(id), patch);

  if (input.syncLinkedStaff && input.permissions) {
    const nextPerms = materializePermissions(
      (patch.permissions as StaffPermissions) || input.permissions,
    );
    await syncLevelPermissionsToLinkedStaff(id, nextPerms);
  }
}

export async function deletePermissionLevel(id: string): Promise<void> {
  const snap = await getDoc(levelRef(id));
  if (!snap.exists()) return;
  const level = mapLevel(id, snap.data() as Record<string, unknown>);
  if (level.isSystem || isOwnerSystemLevel(level)) {
    throw new Error("ลำดับระบบลบไม่ได้ — ปิดใช้งานแทนได้");
  }
  const staffList = await listStaff();
  const linked = staffList.filter((m) => m.permissionLevelId === id);
  if (linked.length) {
    throw new Error(`ยังมี ${linked.length} คนผูกลำดับนี้ — ย้ายก่อนแล้วค่อยลบ`);
  }
  await deleteDoc(levelRef(id));
}

export function permissionsMatchLevel(
  memberPerms: Partial<StaffPermissions> | null | undefined,
  level: PermissionLevel,
): boolean {
  return permissionsEqual(
    materializePermissions(memberPerms),
    materializePermissions(level.permissions),
  );
}

/** ป้ายลำดับสิทธิ์สั้นๆ สำหรับตารางทีม / รายชื่อบัญชี */
export function staffLevelBadgeLabel(
  member: { role?: string; permissionLevelId?: string; permissionsCustomized?: boolean } | null | undefined,
  levels: PermissionLevel[],
): string {
  if (!member) return "—";
  if (member.role === "owner") {
    return findLevel(levels, SEED_LEVEL_IDS.owner)?.name || "เจ้าของ";
  }
  const level = findLevel(levels, member.permissionLevelId);
  if (level) return level.name;
  if (member.permissionsCustomized) return "กำหนดเอง";
  return "—";
}
