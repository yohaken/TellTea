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

export function formatDateShort(ms: number) {
  const d = new Date(ms);
  return `${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(-2)}`;
}

/** Short date + time for «แก้ไขล่าสุด» column — e.g. 12/7/26 10:42 */
export function formatDateTimeShort(ms: number) {
  if (!ms) return "—";
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${formatDateShort(ms)} ${hh}:${mi}`;
}

/** Prefer updatedAt; fall back to createdAt for legacy rows. */
export function entryUpdatedAt(entry: { updatedAt?: number; createdAt?: number }) {
  return Number(entry.updatedAt) || Number(entry.createdAt) || 0;
}

/** parse D/M/YYYY or YYYY-MM-DD to local midnight */
export function parseDateInput(value: string): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, day] = value.split("-").map(Number);
    return new Date(y, m - 1, day).getTime();
  }
  const parts = value.split("/").map(Number);
  if (parts.length === 3) {
    const [day, m, y] = parts;
    return new Date(y, m - 1, day).getTime();
  }
  throw new Error("รูปแบบวันที่ไม่ถูกต้อง");
}

export function todayInputValue(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function startOfLocalDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
