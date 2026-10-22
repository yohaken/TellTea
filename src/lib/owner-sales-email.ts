/**
 * ส่งยอดขายหน้าร้านเข้า Gmail ทันทีเมื่อปิดรอบ POS
 * ตั้งค่า: meta/ownerSalesEmail · สถานะล่าสุด: meta/ownerSalesEmailState (เขียนโดย Cloud Function)
 */
import { doc, getDoc, setDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { getDb, getFirebaseFunctions } from "./firebase";

export const DEFAULT_SALES_EMAIL_RECIPIENT = "yohaken@gmail.com";
const MAX_RECIPIENTS = 5;
const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

export type OwnerSalesEmailSettings = {
  enabled: boolean;
  recipients: string[];
  updatedAt: number;
  updatedBy: string;
};

export type OwnerSalesEmailState = {
  lastSentAt: number;
  lastDateKey: string;
  lastTo: string[];
  lastError: string;
  lastErrorAt: number;
};

export const DEFAULT_OWNER_SALES_EMAIL: OwnerSalesEmailSettings = {
  enabled: true,
  recipients: [DEFAULT_SALES_EMAIL_RECIPIENT],
  updatedAt: 0,
  updatedBy: "",
};

/** แยกอีเมลจากข้อความ (คั่นด้วยจุลภาค / เว้นวรรค / ขึ้นบรรทัด) — คืนรายการที่ใช้ได้ + รายการที่ผิดรูปแบบ */
export function parseRecipientsInput(input: string): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const part of String(input || "").split(/[\s,;]+/)) {
    const email = part.trim().toLowerCase();
    if (!email) continue;
    if (!EMAIL_RE.test(email)) {
      invalid.push(part.trim());
      continue;
    }
    if (!valid.includes(email)) valid.push(email);
  }
  return { valid: valid.slice(0, MAX_RECIPIENTS), invalid };
}

function settingsRef() {
  return doc(getDb(), "meta", "ownerSalesEmail");
}

export async function getOwnerSalesEmailSettings(): Promise<OwnerSalesEmailSettings> {
  const snap = await getDoc(settingsRef());
  if (!snap.exists()) return { ...DEFAULT_OWNER_SALES_EMAIL };
  const d = snap.data() as Partial<OwnerSalesEmailSettings>;
  return {
    enabled: d.enabled !== false,
    recipients: Array.isArray(d.recipients)
      ? parseRecipientsInput(d.recipients.join(",")).valid
      : [DEFAULT_SALES_EMAIL_RECIPIENT],
    updatedAt: Number(d.updatedAt) || 0,
    updatedBy: String(d.updatedBy || ""),
  };
}

export async function saveOwnerSalesEmailSettings(
  input: { enabled: boolean; recipientsText: string },
  actorId: string,
): Promise<OwnerSalesEmailSettings> {
  const { valid, invalid } = parseRecipientsInput(input.recipientsText);
  if (invalid.length) {
    throw new Error(`อีเมลไม่ถูกต้อง: ${invalid.join(", ")}`);
  }
  if (input.enabled && !valid.length) {
    throw new Error("ใส่อีเมลผู้รับอย่างน้อย 1 อีเมล");
  }
  const next: OwnerSalesEmailSettings = {
    enabled: input.enabled,
    recipients: valid,
    updatedAt: Date.now(),
    updatedBy: actorId || "owner",
  };
  await setDoc(settingsRef(), next, { merge: true });
  return next;
}

export async function getOwnerSalesEmailState(): Promise<OwnerSalesEmailState> {
  const snap = await getDoc(doc(getDb(), "meta", "ownerSalesEmailState"));
  const d = (snap.exists() ? snap.data() : {}) as Record<string, unknown>;
  return {
    lastSentAt: Number(d.lastSentAt) || 0,
    lastDateKey: String(d.lastDateKey || ""),
    lastTo: Array.isArray(d.lastTo) ? d.lastTo.map(String) : [],
    lastError: String(d.lastError || ""),
    lastErrorAt: Number(d.lastErrorAt) || 0,
  };
}

export async function sendOwnerSalesEmailNow(
  dateKey?: string,
): Promise<{ ok: boolean; detail: string }> {
  const fn = httpsCallable<{ dateKey?: string }, { ok?: boolean; detail?: string }>(
    getFirebaseFunctions(),
    "ownerSalesEmailSendNow",
  );
  const res = await fn(dateKey ? { dateKey } : {});
  return { ok: Boolean(res.data?.ok), detail: String(res.data?.detail || "") };
}
