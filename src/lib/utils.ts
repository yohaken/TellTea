import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
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
