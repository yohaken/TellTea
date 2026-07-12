import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  deleteDoc,
  deleteField,
  query,
  orderBy,
  updateDoc,
} from "firebase/firestore";
import { getDb, OWNER_EMAIL } from "./firebase";
import type { StaffMember, StaffRole } from "./types";
import {
  normalizeEmail,
  normalizePhone,
  phoneDigitsFromE164,
  phoneDocId,
} from "./utils";
import {
  normalizePermissions,
  type StaffPermissions,
} from "./permissions";
import {
  clearEmployeeLinkByStaffId,
  linkEmployeeProfile,
  listActiveEmployees,
} from "./employees";

function staffRef(staffId: string) {
  return doc(getDb(), "staff", staffId);
}

function staffPhoneRef(phone: string) {
  return doc(getDb(), "staffPhones", phoneDigitsFromE164(phone));
}

function mapStaff(staffId: string, data: StaffMember): StaffMember {
  return {
    ...data,
    id: staffId,
    permissions: normalizePermissions(data.permissions, data.role),
  };
}

export function resolveStaffDocId(input: { email?: string; phone?: string }): string {
  if (input.email) return normalizeEmail(input.email);
  if (input.phone) return phoneDocId(input.phone);
  throw new Error("ต้องใส่อีเมลหรือเบอร์โทรอย่างน้อยหนึ่งอย่าง");
}

async function syncStaffPhoneIndex(staffId: string, phone?: string | null): Promise<void> {
  if (!phone) return;
  await setDoc(staffPhoneRef(phone), { staffId });
}

async function clearStaffPhoneIndex(phone?: string): Promise<void> {
  if (!phone) return;
  await deleteDoc(staffPhoneRef(phone)).catch(() => undefined);
}

export async function getStaffMemberById(staffId: string): Promise<StaffMember | null> {
  const snap = await getDoc(staffRef(staffId));
  if (!snap.exists()) return null;
  return mapStaff(staffId, snap.data() as StaffMember);
}

/** @deprecated use getStaffMemberById — kept for email-keyed callers */
export async function getStaffMember(email: string): Promise<StaffMember | null> {
  return getStaffMemberById(normalizeEmail(email));
}

export async function getStaffByPhone(phone: string): Promise<StaffMember | null> {
  const index = await getDoc(staffPhoneRef(phone));
  if (!index.exists()) return null;
  const staffId = (index.data() as { staffId?: string }).staffId;
  if (!staffId) return null;
  return getStaffMemberById(staffId);
}

/** First owner bootstrap: create owner doc if signing in as configured owner. */
export async function ensureOwnerBootstrap(
  email: string,
  displayName?: string | null,
): Promise<StaffMember | null> {
  const normalized = normalizeEmail(email);
  const existing = await getStaffMemberById(normalized);
  if (existing) return existing;

  if (normalized !== OWNER_EMAIL) {
    return null;
  }

  const member: StaffMember = {
    id: normalized,
    email: normalized,
    role: "owner",
    displayName: displayName || undefined,
    profileComplete: true,
    createdAt: Date.now(),
    permissions: normalizePermissions(null, "owner"),
  };
  await setDoc(staffRef(normalized), member);
  return member;
}

export async function listStaff(): Promise<StaffMember[]> {
  const snap = await getDocs(query(collection(getDb(), "staff"), orderBy("createdAt", "asc")));
  return snap.docs.map((d) => mapStaff(d.id, d.data() as StaffMember));
}

export type StaffAccountInput = {
  email?: string;
  phone?: string;
  role: StaffRole;
  permissions?: Partial<StaffPermissions>;
  displayName?: string;
  employeeId?: string;
};

/** Create or update account — preserves profile fields. */
export async function upsertStaffAccount(input: StaffAccountInput): Promise<string> {
  const email = input.email?.trim() ? normalizeEmail(input.email) : undefined;
  const phone = input.phone?.trim() ? normalizePhone(input.phone) : undefined;
  if (!email && !phone) throw new Error("ต้องใส่อีเมลหรือเบอร์โทรอย่างน้อยหนึ่งอย่าง");

  const staffId = resolveStaffDocId({ email, phone });
  const existing = await getStaffMemberById(staffId);

  const patch: Record<string, unknown> = {
    role: input.role,
    permissions: normalizePermissions(input.permissions ?? existing?.permissions, input.role),
  };
  if (email) patch.email = email;
  if (phone) patch.phone = phone;
  if (input.displayName !== undefined) {
    patch.displayName = input.displayName || deleteField();
  }
  if (!existing) {
    patch.createdAt = Date.now();
  }

  if (phone && existing?.phone && existing.phone !== phone) {
    await clearStaffPhoneIndex(existing.phone);
  }

  await setDoc(staffRef(staffId), patch, { merge: true });
  if (phone) await syncStaffPhoneIndex(staffId, phone);

  return staffId;
}

/** @deprecated use upsertStaffAccount */
export async function upsertStaff(
  email: string,
  role: StaffRole,
  permissions?: Partial<StaffPermissions>,
  displayName?: string,
): Promise<void> {
  await upsertStaffAccount({ email, role, permissions, displayName });
}

export async function updateStaffPermissions(
  staffId: string,
  permissions: Partial<StaffPermissions>,
): Promise<void> {
  const existing = await getStaffMemberById(staffId);
  if (!existing) throw new Error("ไม่พบบัญชีพนักงาน");
  await updateDoc(staffRef(staffId), {
    permissions: normalizePermissions(permissions, existing.role),
  });
}

/** Owner adds/updates account and optionally links to roster name. */
export async function upsertStaffWithLink(input: StaffAccountInput): Promise<string> {
  const email = input.email?.trim() ? normalizeEmail(input.email) : undefined;
  const phone = input.phone?.trim() ? normalizePhone(input.phone) : undefined;
  const staffId = resolveStaffDocId({ email, phone });

  if (input.role === "staff" && input.employeeId) {
    const employees = await listActiveEmployees();
    const emp = employees.find((e) => e.id === input.employeeId);
    if (!emp) throw new Error("ไม่พบชื่อในรายชื่อร้าน");
    if (emp.linkedStaffId && emp.linkedStaffId !== staffId) {
      throw new Error("ชื่อนี้มีคนเชื่อมบัญชีแล้ว");
    }
    await upsertStaffAccount({
      ...input,
      email,
      phone,
      displayName: emp.name,
    });
    await linkEmployeeProfile(input.employeeId, staffId, emp.name, email, phone);
    await updateStaffProfile(staffId, {
      displayName: emp.name,
      employeeId: input.employeeId,
      profileComplete: true,
      profileSnoozeUntil: null,
    });
    return staffId;
  }

  return upsertStaffAccount({ ...input, email, phone });
}

export async function removeStaffById(staffId: string): Promise<void> {
  const existing = await getStaffMemberById(staffId);
  await clearEmployeeLinkByStaffId(staffId);
  if (existing?.phone) await clearStaffPhoneIndex(existing.phone);
  await deleteDoc(staffRef(staffId));
}

/** @deprecated use removeStaffById */
export async function removeStaff(email: string): Promise<void> {
  await removeStaffById(normalizeEmail(email));
}

export type StaffProfilePatch = {
  displayName?: string | null;
  employeeId?: string | null;
  profileComplete?: boolean;
  profileSnoozeUntil?: number | null;
};

export async function updateStaffProfile(
  staffId: string,
  patch: StaffProfilePatch,
): Promise<StaffMember> {
  const existing = await getStaffMemberById(staffId);
  if (!existing) throw new Error("ไม่พบบัญชีพนักงาน");

  const next: Record<string, unknown> = {};
  if (patch.displayName !== undefined) {
    next.displayName =
      patch.displayName && patch.displayName.trim()
        ? patch.displayName.trim()
        : deleteField();
  }
  if (patch.employeeId !== undefined) {
    next.employeeId =
      patch.employeeId && patch.employeeId.trim() ? patch.employeeId : deleteField();
  }
  if (patch.profileComplete !== undefined) next.profileComplete = patch.profileComplete;
  if (patch.profileSnoozeUntil !== undefined) {
    next.profileSnoozeUntil =
      patch.profileSnoozeUntil == null ? deleteField() : patch.profileSnoozeUntil;
  }

  await updateDoc(staffRef(staffId), next);
  const updated = await getStaffMemberById(staffId);
  if (!updated) throw new Error("อัปเดตโปรไฟล์ไม่สำเร็จ");
  return updated;
}
