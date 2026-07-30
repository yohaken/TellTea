import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

/** Thai mobile → E.164 (+66812345678) */
export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (!digits) throw new Error("เบอร์โทรไม่ถูกต้อง");
  let national = digits;
  if (digits.startsWith("66")) {
    national = digits;
  } else if (digits.startsWith("0")) {
    national = `66${digits.slice(1)}`;
  } else if (digits.length === 9) {
    national = `66${digits}`;
  } else {
    throw new Error("เบอร์โทรไม่ถูกต้อง");
  }
  if (national.length < 10 || national.length > 12) {
    throw new Error("เบอร์โทรไม่ถูกต้อง");
  }
  return `+${national}`;
}

export function phoneDigitsFromE164(phone: string): string {
  return normalizePhone(phone).slice(1);
}

/** Firestore staff doc id for phone-only accounts */
export function phoneDocId(phone: string): string {
  return `p_${phoneDigitsFromE164(phone)}`;
}

export function formatPhoneDisplay(phone: string): string {
  const e164 = normalizePhone(phone);
  if (e164.startsWith("+66") && e164.length >= 12) {
    return `0${e164.slice(3)}`;
  }
  return e164;
}

export function staffAccountLabel(member: { email?: string; phone?: string }): string {
  if (member.email) return member.email;
  if (member.phone) return formatPhoneDisplay(member.phone);
  return "—";
}

export function formatBaht(amount: number) {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Plain number without currency symbol */
export function formatPlainNumber(amount: number) {
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Integer qty — stock counts, pieces, units (no decimals) */
export function formatStockQty(amount: number) {
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
}

/**
 * Coerce Firestore number | Timestamp | ISO/D-M-Y string → epoch ms.
 * Mixed field types in `ledger.date` used to break UI order (Firestore DESC
 * returns strings/timestamps before numbers; a weak coerce kept that order).
 */
export function toEpochMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    // epoch ms (~1e12), epoch seconds (~1e9), Excel serial (~4e4–6e4)
    if (value > 1e11) return value;
    if (value > 1e9) return Math.round(value * 1000);
    if (value > 20000 && value < 100000) {
      // Excel serial day → UTC ms (1899-12-30 epoch)
      return Math.round((value - 25569) * 86400 * 1000);
    }
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const t = value.trim();
    if (/^\d+(\.\d+)?$/.test(t)) return toEpochMs(Number(t));
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
      const ms = Date.parse(`${t}T00:00:00+07:00`);
      return Number.isFinite(ms) ? ms : 0;
    }
    if (/^\d{4}-\d{2}-\d{2}T/.test(t)) {
      const ms = Date.parse(t);
      return Number.isFinite(ms) ? ms : 0;
    }
    const slash = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (slash) {
      let y = Number(slash[3]);
      if (y < 100) y += 2000;
      const day = Number(slash[1]);
      const month = Number(slash[2]);
      const ms = Date.parse(
        `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00+07:00`,
      );
      return Number.isFinite(ms) ? ms : 0;
    }
  }
  if (value && typeof value === "object") {
    const v = value as {
      toMillis?: () => number;
      seconds?: unknown;
      nanoseconds?: unknown;
      _seconds?: unknown;
      _nanoseconds?: unknown;
    };
    if (typeof v.toMillis === "function") {
      const ms = v.toMillis();
      if (Number.isFinite(ms)) return ms;
    }
    const seconds = v.seconds ?? v._seconds;
    const nanos = v.nanoseconds ?? v._nanoseconds;
    if (seconds != null) {
      const s = Number(seconds);
      const ns = Number(nanos) || 0;
      if (Number.isFinite(s)) return s * 1000 + Math.floor(ns / 1e6);
    }
  }
  return 0;
}

/** Asia/Bangkok calendar day as YYYY-MM-DD — stable sort/display key. */
export function bangkokDateKey(ms: number): string {
  if (!ms) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

/** Asia/Bangkok day/month/year parts for table cells. */
export function bangkokDateParts(ms: number): { day: number; month: number; year2: string } | null {
  if (!ms) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "numeric",
    year: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  const day = Number(get("day"));
  const month = Number(get("month"));
  const year2 = get("year");
  if (!day || !month || !year2) return null;
  return { day, month, year2 };
}

/** Short date in Asia/Bangkok — e.g. 30/7/26 (not device timezone). */
export function formatDateShort(ms: number) {
  const p = bangkokDateParts(ms);
  if (!p) return "—";
  return `${p.day}/${p.month}/${p.year2}`;
}

/** Short date + time for «แก้ไขล่าสุด» — Asia/Bangkok. */
export function formatDateTimeShort(ms: number) {
  if (!ms) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "numeric",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  const hh = String(get("hour")).padStart(2, "0");
  const mi = String(get("minute")).padStart(2, "0");
  return `${Number(get("day"))}/${Number(get("month"))}/${get("year")} ${hh}:${mi}`;
}

/** Prefer updatedAt; fall back to createdAt for legacy rows. */
export function entryUpdatedAt(entry: { updatedAt?: number; createdAt?: number }) {
  return toEpochMs(entry.updatedAt) || toEpochMs(entry.createdAt) || 0;
}

/** parse D/M/YYYY or YYYY-MM-DD → Asia/Bangkok midnight ms */
export function parseDateInput(value: string): number {
  let y: number;
  let m: number;
  let day: number;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    [y, m, day] = value.split("-").map(Number);
  } else {
    const parts = value.split("/").map(Number);
    if (parts.length !== 3) throw new Error("รูปแบบวันที่ไม่ถูกต้อง");
    [day, m, y] = parts;
  }
  if (!y || !m || !day) throw new Error("รูปแบบวันที่ไม่ถูกต้อง");
  const ms = Date.parse(
    `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00+07:00`,
  );
  if (!Number.isFinite(ms)) throw new Error("รูปแบบวันที่ไม่ถูกต้อง");
  return ms;
}

/** YYYY-MM-DD for `<input type="date">` — Asia/Bangkok calendar day. */
export function todayInputValue(date: Date | number = new Date()) {
  const ms = typeof date === "number" ? date : date.getTime();
  return bangkokDateKey(ms) || bangkokDateKey(Date.now());
}

export function startOfLocalDay(date: Date | number = new Date()) {
  // Always Asia/Bangkok calendar day (matches Cloud Functions bangkok-day.js).
  // Host timezone must not affect POS day buckets.
  const ms = typeof date === "number" ? date : date instanceof Date ? date.getTime() : Date.now();
  const key = bangkokDateKey(ms);
  if (!key) return Date.UTC(1970, 0, 1) - 7 * 60 * 60 * 1000;
  return Date.parse(`${key}T00:00:00+07:00`);
}

/** Bangkok calendar midnight ms for sorting/display — 0 if unknown. */
export function accountingDayMs(value: unknown): number {
  const ms = toEpochMs(value);
  return ms ? startOfLocalDay(ms) : 0;
}
