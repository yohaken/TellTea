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
import { normalizeEmail } from "./utils";
import {
  normalizePermissions,
  type StaffPermissions,
} from "./permissions";
import {
  clearEmployeeLinkByEmail,
  linkEmployeeProfile,
  listActiveEmployees,
} from "./employees";

function staffRef(email: string) {
  return doc(getDb(), "staff", normalizeEmail(email));
}

function mapStaff(data: StaffMember): StaffMember {
  return {
    ...data,
    permissions: normalizePermissions(data.permissions, data.role),
  };
}

export async function getStaffMember(email: string): Promise<StaffMember | null> {
  const snap = await getDoc(staffRef(email));
  if (!snap.exists()) return null;
  return mapStaff(snap.data() as StaffMember);
}

/** First owner bootstrap: create owner doc if signing in as configured owner. */
export async function ensureOwnerBootstrap(
  email: string,
  displayName?: string | null,
): Promise<StaffMember | null> {
  const normalized = normalizeEmail(email);
  const existing = await getStaffMember(normalized);
  if (existing) return existing;

  if (normalized !== OWNER_EMAIL) {
    return null;
  }

  const member: StaffMember = {
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
  return snap.docs.map((d) => mapStaff(d.data() as StaffMember));
}

/** Create or update account — preserves profile fields (employeeId, profileComplete, etc.). */
export async function upsertStaff(
  email: string,
  role: StaffRole,
  permissions?: Partial<StaffPermissions>,
  displayName?: string,
): Promise<void> {
  const normalized = normalizeEmail(email);
  const existing = await getStaffMember(normalized);
  const patch: Record<string, unknown> = {
    email: normalized,
    role,
    permissions: normalizePermissions(permissions ?? existing?.permissions, role),
  };
  if (displayName !== undefined) {
    patch.displayName = displayName || deleteField();
  }
  if (!existing) {
    patch.createdAt = Date.now();
  }
  await setDoc(staffRef(normalized), patch, { merge: true });
}

/** Update permissions only — does not touch profile link fields. */
export async function updateStaffPermissions(
  email: string,
  permissions: Partial<StaffPermissions>,
): Promise<void> {
  const normalized = normalizeEmail(email);
  const existing = await getStaffMember(normalized);
  if (!existing) throw new Error("ไม่พบบัญชีพนักงาน");
  await updateDoc(staffRef(normalized), {
    permissions: normalizePermissions(permissions, existing.role),
  });
}

/** Owner adds/updates account and optionally links to roster name at creation. */
export async function upsertStaffWithLink(
  email: string,
  role: StaffRole,
  permissions?: Partial<StaffPermissions>,
  employeeId?: string,
): Promise<void> {
  const normalized = normalizeEmail(email);
  const existing = await getStaffMember(normalized);

  if (role === "staff" && employeeId) {
    const employees = await listActiveEmployees();
    const emp = employees.find((e) => e.id === employeeId);
    if (!emp) throw new Error("ไม่พบชื่อในรายชื่อร้าน");
    if (emp.linkedEmail && normalizeEmail(emp.linkedEmail) !== normalized) {
      throw new Error("ชื่อนี้มีคนเชื่อมบัญชีแล้ว");
    }
    await upsertStaff(email, role, permissions, emp.name);
    await linkEmployeeProfile(employeeId, normalized, emp.name);
    await updateStaffProfile(normalized, {
      displayName: emp.name,
      employeeId,
      profileComplete: true,
      profileSnoozeUntil: null,
    });
    return;
  }

  if (!existing) {
    await upsertStaff(email, role, permissions);
    return;
  }

  await upsertStaff(email, role, permissions);
}

export async function removeStaff(email: string): Promise<void> {
  await clearEmployeeLinkByEmail(email);
  await deleteDoc(staffRef(email));
}

export type StaffProfilePatch = {
  displayName?: string | null;
  employeeId?: string | null;
  profileComplete?: boolean;
  profileSnoozeUntil?: number | null;
};

export async function updateStaffProfile(
  email: string,
  patch: StaffProfilePatch,
): Promise<StaffMember> {
  const normalized = normalizeEmail(email);
  const existing = await getStaffMember(normalized);
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

  await updateDoc(staffRef(normalized), next);
  const updated = await getStaffMember(normalized);
  if (!updated) throw new Error("อัปเดตโปรไฟล์ไม่สำเร็จ");
  return updated;
}
