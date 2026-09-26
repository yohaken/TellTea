import type { LedgerEntry, StaffMember } from "./types";

const STAFF_KEY = "telltea_staff_v1";
const LEDGER_KEY = "telltea_ledger_v1";

export type LedgerSnapshot = {
  entries: LedgerEntry[];
  balance: number | null;
  hasMore: boolean;
  savedAt: number;
};

function canUseStorage() {
  return typeof window !== "undefined";
}

type CachedStaffRecord = StaffMember & { cachedAt?: number; authUid?: string };

/**
 * @param staffId — staff id / email / phone หรือ Firebase Auth uid ที่บันทึกไว้ตอน save
 */
export function loadCachedStaff(staffId: string): StaffMember | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(STAFF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedStaffRecord;
    if (!parsed?.id) return null;
    if (
      parsed.id !== staffId &&
      parsed.email !== staffId &&
      parsed.phone !== staffId &&
      parsed.authUid !== staffId
    ) {
      return null;
    }
    return {
      id: parsed.id,
      email: parsed.email,
      phone: parsed.phone,
      role: parsed.role,
      displayName: parsed.displayName,
      employeeId: parsed.employeeId,
      profileComplete: parsed.profileComplete,
      profileSnoozeUntil: parsed.profileSnoozeUntil,
      personalProfileComplete: parsed.personalProfileComplete,
      personal: parsed.personal,
      createdAt: parsed.createdAt,
      permissions: parsed.permissions,
      permissionLevelId: parsed.permissionLevelId,
      permissionsCustomized: parsed.permissionsCustomized,
    };
  } catch {
    return null;
  }
}

export function saveCachedStaff(staff: StaffMember, authUid?: string) {
  if (!canUseStorage()) return;
  try {
    const record: CachedStaffRecord = { ...staff, cachedAt: Date.now() };
    if (authUid) record.authUid = authUid;
    window.localStorage.setItem(STAFF_KEY, JSON.stringify(record));
  } catch {
    // quota / private mode
  }
}

export function clearCachedStaff() {
  if (!canUseStorage()) return;
  window.localStorage.removeItem(STAFF_KEY);
}

export function loadCachedLedger(): LedgerSnapshot | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(LEDGER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LedgerSnapshot;
    if (!Array.isArray(parsed.entries)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveCachedLedger(snapshot: Omit<LedgerSnapshot, "savedAt">) {
  if (!canUseStorage()) return;
  try {
    const payload: LedgerSnapshot = { ...snapshot, savedAt: Date.now() };
    window.localStorage.setItem(LEDGER_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

export function clearCachedLedger() {
  if (!canUseStorage()) return;
  window.localStorage.removeItem(LEDGER_KEY);
}

export function clearAppCaches() {
  clearCachedStaff();
  clearCachedLedger();
}
