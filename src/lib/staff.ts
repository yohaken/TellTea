import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  deleteDoc,
  query,
  orderBy,
} from "firebase/firestore";
import { getDb, OWNER_EMAIL } from "./firebase";
import type { StaffMember, StaffRole } from "./types";
import { normalizeEmail } from "./utils";
import {
  normalizePermissions,
  type StaffPermissions,
} from "./permissions";

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

export async function upsertStaff(
  email: string,
  role: StaffRole,
  permissions?: Partial<StaffPermissions>,
  displayName?: string,
): Promise<void> {
  const normalized = normalizeEmail(email);
  const existing = await getStaffMember(normalized);
  const member: StaffMember = {
    email: normalized,
    role,
    displayName: displayName || existing?.displayName,
    createdAt: existing?.createdAt ?? Date.now(),
    permissions: normalizePermissions(
      permissions ?? existing?.permissions,
      role,
    ),
  };
  await setDoc(staffRef(normalized), member);
}

export async function removeStaff(email: string): Promise<void> {
  await deleteDoc(staffRef(email));
}
