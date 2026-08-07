import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { resolveLinkedEmployee, type Employee } from "./employees";
import type { StaffMember } from "./types";
import { mapFirestoreError } from "./firestore-errors";
import { normalizeEmail, normalizePhone, phoneDocId } from "./utils";

/** วนปัก lastSeenAt ระหว่างเซสชันปกติ (~2 นาที) — ตาราง staff เป็นแหล่งความจริง */
export const STAFF_PRESENCE_HEARTBEAT_MS = 2 * 60_000;
/** ช่วงเปิดหน้าใหม่ — ปักถี่เพื่อให้เจ้าของเห็นทันที */
export const STAFF_PRESENCE_WARMUP_MS = 30_000;
/** รีเฟรชป้ายอายุบน dock ของเจ้าของ (คำนวณจาก lastSeenAt ในตาราง) */
export const STAFF_PRESENCE_AGE_TICK_MS = 30_000;
/** ออนไลน์สด (เขียว) — เห็นภายใน 5 นาทีหลัง heartbeat */
export const STAFF_PRESENCE_ONLINE_MS = 5 * 60_000;

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

/**
 * หาแถว roster ที่ผูกบัญชี — ลำดับเดียวกับ resolveLinkedEmployee
 * (employeeId → linkedStaffId/email/phone → ชื่อ/ชื่อเล่น)
 * ใช้ตอนพรีวิวจาก dock เพื่อส่ง employeeId ครบ
 */
export function findEmployeeForPresence(
  member: StaffMember,
  employees: Employee[],
): Employee | undefined {
  return resolveLinkedEmployee(employees, member) || undefined;
}

/** ชื่อเล่นเต็มก่อน · ไม่มีชื่อเล่นค่อยย่อจากชื่อจริง */
export function resolvePresenceLabel(
  member: StaffMember,
  employees: Employee[],
): { label: string; fullName: string } {
  const emp = findEmployeeForPresence(member, employees);
  const nick = emp?.nickname?.trim();
  const fullName = (emp?.name || member.displayName || "").trim() || member.id;
  if (nick) {
    return { label: nick, fullName };
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

function bangkokDayKey(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function bangkokClock(ms: number): string {
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

/** นาฬิกาเข้าล่าสุด — วันนี้/เมื่อวาน/วันที่ · บอกว่าใครเข้าใช้ตอนไหน */
export function formatPresenceLastLogin(lastSeenAt: number, now = Date.now()): string {
  if (!lastSeenAt || lastSeenAt <= 0) return "ยังไม่เคยเข้า";
  const time = bangkokClock(lastSeenAt);
  const seenDay = bangkokDayKey(lastSeenAt);
  const today = bangkokDayKey(now);
  const yDay = bangkokDayKey(now - 24 * 60 * 60 * 1000);
  if (seenDay === today) return `วันนี้ ${time}`;
  if (seenDay === yDay) return `เมื่อวาน ${time}`;
  const date = new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
  }).format(new Date(lastSeenAt));
  return `${date} ${time}`;
}

/** แสดงพนักงานทุกคน — ยังไม่มี lastSeenAt ก็โชว์รอ (ป้าย —) */
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
    .sort((a, b) => {
      // มีเวลาเข้าล่าสุดก่อน · ยังไม่เคยอยู่ท้าย · ในกลุ่มเดียวกันเรียงชื่อ
      if (a.lastSeenAt !== b.lastSeenAt) {
        if (!a.lastSeenAt) return 1;
        if (!b.lastSeenAt) return -1;
        return b.lastSeenAt - a.lastSeenAt;
      }
      return a.label.localeCompare(b.label, "th");
    });
}

function mapStaffDoc(id: string, data: Record<string, unknown>): StaffMember {
  const permissionLevelId =
    typeof data.permissionLevelId === "string" ? data.permissionLevelId : undefined;
  const rawPerms = data.permissions;
  return {
    id,
    email: typeof data.email === "string" ? data.email : undefined,
    phone: typeof data.phone === "string" ? data.phone : undefined,
    role: data.role === "owner" ? "owner" : "staff",
    displayName: typeof data.displayName === "string" ? data.displayName : undefined,
    employeeId: typeof data.employeeId === "string" ? data.employeeId : undefined,
    // ต้องมี level/perms ครบ — พรีวิวจาก dock ถึงได้สิทธิ์ + กรองข้อมูลเหมือนล็อกอินจริง
    permissionLevelId,
    permissions:
      rawPerms && typeof rawPerms === "object"
        ? (rawPerms as StaffMember["permissions"])
        : undefined,
    permissionsCustomized: data.permissionsCustomized === true,
    profileComplete: data.profileComplete === true,
    lastSeenAt: coercePresenceMs(data.lastSeenAt),
    createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
  };
}

/** Firestore อาจส่ง number / numeric string / Timestamp — อย่าทิ้งเป็น undefined แล้วชิปโชว์ — */
function coercePresenceMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (value && typeof value === "object") {
    const ts = value as { toMillis?: () => number; seconds?: number };
    if (typeof ts.toMillis === "function") {
      const n = ts.toMillis();
      if (Number.isFinite(n) && n > 0) return n;
    }
    if (typeof ts.seconds === "number" && Number.isFinite(ts.seconds)) {
      const n = ts.seconds * 1000;
      if (n > 0) return n;
    }
  }
  return undefined;
}

/**
 * แปลง actorId จากงาน (อีเมล / E.164 / p_…) → staff doc id
 * เบอร์โทรต้อง map ผ่าน staffPhones หรือ p_<digits> — ห้าม updateDoc ด้วย +66…
 */
export async function resolvePresenceStaffId(
  actorId: string | null | undefined,
): Promise<string | null> {
  const raw = String(actorId || "").trim();
  if (!raw) return null;
  if (raw.includes("@")) return normalizeEmail(raw);
  if (raw.startsWith("p_")) return raw;

  if (raw.startsWith("+") || /^0\d{8,}$/.test(raw)) {
    try {
      const e164 = normalizePhone(raw);
      const digits = e164.slice(1);
      const index = await getDoc(doc(getDb(), "staffPhones", digits));
      const mapped = index.exists()
        ? String((index.data() as { staffId?: string }).staffId || "").trim()
        : "";
      if (mapped) return mapped;
      return phoneDocId(e164);
    } catch {
      return null;
    }
  }

  return raw;
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
        snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            name: String(data.name || ""),
            nickname: data.nickname ? String(data.nickname) : undefined,
            active: data.active !== false,
            linkedEmail: data.linkedEmail ? String(data.linkedEmail) : undefined,
            linkedPhone: data.linkedPhone ? String(data.linkedPhone) : undefined,
            linkedStaffId: data.linkedStaffId ? String(data.linkedStaffId) : undefined,
            createdAt: Number(data.createdAt) || 0,
            updatedAt: Number(data.updatedAt) || 0,
          } satisfies Employee;
        }),
      );
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

/** Admin callable — เมื่อ rules ฝั่ง client ปฏิเสธการปัก lastSeenAt */
async function touchStaffPresenceViaCallable(): Promise<boolean> {
  try {
    const { httpsCallable } = await import("firebase/functions");
    const { getFirebaseFunctions } = await import("./firebase");
    const fn = httpsCallable(getFirebaseFunctions(), "touchStaffPresence");
    const res = await fn({});
    const data = (res?.data || {}) as { ok?: boolean };
    return data.ok !== false;
  } catch (err) {
    if (typeof console !== "undefined") {
      console.warn(mapFirestoreError(err, "อัปเดตเข้าใช้ล่าสุด (server)", "staff"));
    }
    return false;
  }
}

/** พนักงาน/เจ้าของอัปเดตว่าเข้าใช้ล่าสุดเมื่อไหร่ — คืน true เมื่อเขียนสำเร็จ */
export async function touchStaffPresence(staffId: string): Promise<boolean> {
  if (!staffId) return false;
  const at = Date.now();
  const ref = doc(getDb(), "staff", staffId);
  try {
    await updateDoc(ref, { lastSeenAt: at });
    return true;
  } catch (err) {
    // fallback merge — บางเคส update อย่างเดียวสะดุดตอน rules/token ยังไม่พร้อม
    try {
      await setDoc(ref, { lastSeenAt: at }, { merge: true });
      return true;
    } catch (err2) {
      // ทางหลักที่พังกับพนักงานจริง: rules ปฏิเสธ — ให้ Cloud Function ปักแทน
      if (await touchStaffPresenceViaCallable()) return true;
      if (typeof console !== "undefined") {
        console.warn(mapFirestoreError(err2 ?? err, "อัปเดตเข้าใช้ล่าสุด", "staff"));
      }
      return false;
    }
  }
}

const PRESENCE_TOUCH_RETRIES_MS = [0, 1_500, 5_000] as const;

/**
 * ปัก lastSeenAt หลังบันทึกงานจริง (สต็อก/ผลิต/OT…) — resolve actor → staff id + retry
 * มือถือเปิดคีย์บอร์ดมักได้ visibility=hidden ทำให้ heartbeat เงียบ — ทางนี้ไม่พึ่ง interval
 */
export async function touchStaffPresenceFromActor(
  actorId: string | null | undefined,
): Promise<boolean> {
  const id = await resolvePresenceStaffId(actorId);
  if (!id) return false;
  for (const delay of PRESENCE_TOUCH_RETRIES_MS) {
    if (delay) {
      await new Promise((r) => setTimeout(r, delay));
    }
    if (await touchStaffPresence(id)) return true;
  }
  return false;
}
