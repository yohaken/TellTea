import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";
import type { Employee } from "./employees";
import type { StaffMember } from "./types";
import { mapFirestoreError } from "./firestore-errors";

/** ถือว่ายังอยู่ในระบบถ้าเห็นภายในช่วงนี้ */
export const STAFF_PRESENCE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** heartbeat ระหว่างใช้งาน */
export const STAFF_PRESENCE_HEARTBEAT_MS = 60_000;
/** ออนไลน์สด (เขียว) */
export const STAFF_PRESENCE_ONLINE_MS = 3 * 60_000;

export type StaffPresenceItem = {
  staffId: string;
  label: string;
  fullName: string;
  lastSeenAt: number;
  online: boolean;
};

/** ชื่อย่อ 1–2 อักษร — รองรับไทย (grapheme รวมวรรณยุกต์) */
export function staffShortLabel(source: string, max = 2): string {
  const t = source.trim().replace(/\s+/g, "");
  if (!t) return "?";
  const chars =
    typeof Intl !== "undefined" && "Segmenter" in Intl
      ? [...new Intl.Segmenter("th", { granularity: "grapheme" }).segment(t)].map((s) => s.segment)
      : [...t];
  if (chars.length <= max) return chars.join("");
  return chars.slice(0, max).join("");
}

/** ชื่อเล่นก่อน · ไม่มีใช้ชื่อจริง/displayName */
export function resolvePresenceLabel(
  member: StaffMember,
  employees: Employee[],
): { label: string; fullName: string } {
  const emp =
    (member.employeeId && employees.find((e) => e.id === member.employeeId)) ||
    employees.find((e) => e.linkedStaffId === member.id);
  const nick = emp?.nickname?.trim();
  const fullName = (emp?.name || member.displayName || "").trim() || member.id;
  if (nick) {
    return { label: staffShortLabel(nick, nick.length <= 2 ? nick.length : 2), fullName };
  }
  return { label: staffShortLabel(fullName, 2), fullName };
}

/** ป้ายเวลาสั้น: 5น · 1ช · 2ว */
export function formatPresenceAge(lastSeenAt: number, now = Date.now()): string {
  if (!lastSeenAt || lastSeenAt <= 0) return "—";
  const sec = Math.max(0, Math.floor((now - lastSeenAt) / 1000));
  if (sec < 60) return "เมื่อกี้";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}น`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}ช`;
  const day = Math.floor(hr / 24);
  return `${day}ว`;
}

export function buildStaffPresenceItems(
  members: StaffMember[],
  employees: Employee[],
  now = Date.now(),
): StaffPresenceItem[] {
  return members
    .filter((m) => m.role === "staff")
    .map((m) => {
      const lastSeenAt = typeof m.lastSeenAt === "number" ? m.lastSeenAt : 0;
      const { label, fullName } = resolvePresenceLabel(m, employees);
      return {
        staffId: m.id,
        label,
        fullName,
        lastSeenAt,
        online: lastSeenAt > 0 && now - lastSeenAt <= STAFF_PRESENCE_ONLINE_MS,
      };
    })
    .filter((p) => p.lastSeenAt > 0 && now - p.lastSeenAt <= STAFF_PRESENCE_WINDOW_MS)
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

function mapStaffDoc(id: string, data: Record<string, unknown>): StaffMember {
  return {
    id,
    email: typeof data.email === "string" ? data.email : undefined,
    phone: typeof data.phone === "string" ? data.phone : undefined,
    role: data.role === "owner" ? "owner" : "staff",
    displayName: typeof data.displayName === "string" ? data.displayName : undefined,
    employeeId: typeof data.employeeId === "string" ? data.employeeId : undefined,
    profileComplete: data.profileComplete === true,
    lastSeenAt: typeof data.lastSeenAt === "number" ? data.lastSeenAt : undefined,
    createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
  };
}

/** เจ้าของฟังรายชื่อ + lastSeenAt แบบสด */
export function subscribeStaffForPresence(
  onStaff: (members: StaffMember[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(getDb(), "staff"), orderBy("createdAt", "asc")),
    (snap) => {
      onStaff(snap.docs.map((d) => mapStaffDoc(d.id, d.data() as Record<string, unknown>)));
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export function subscribeEmployeesForPresence(
  onEmployees: (employees: Employee[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(getDb(), "employees"), orderBy("name", "asc")),
    (snap) => {
      onEmployees(
        snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Employee, "id">),
        })),
      );
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

/** พนักงาน/เจ้าของอัปเดตว่ายังอยู่ในระบบ */
export async function touchStaffPresence(staffId: string): Promise<void> {
  if (!staffId) return;
  try {
    await updateDoc(doc(getDb(), "staff", staffId), { lastSeenAt: Date.now() });
  } catch (err) {
    // ไม่รบกวน UI — heartbeat เงียบ
    if (typeof console !== "undefined") {
      console.warn(mapFirestoreError(err, "อัปเดตสถานะออนไลน์", "staff"));
    }
  }
}
