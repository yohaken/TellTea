/**
 * Append-only audit for VAT sales (owner-only).
 */

import {
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
} from "firebase/firestore";
import { getDb } from "./firebase";

export const VAT_SALES_AUDIT_COL = "vatSalesAudit";

export type VatSalesAuditAction =
  | "upsert_day"
  | "confirm_day"
  | "unconfirm_day"
  | "confirm_email"
  | "close_month"
  | "prune_mail_raw";

export type VatSalesAuditEntry = {
  id: string;
  action: VatSalesAuditAction;
  dateKey: string;
  monthKey: string;
  summary: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  actor: string;
  at: number;
};

function monthFromDateKey(dateKey: string): string {
  return dateKey.length >= 7 ? dateKey.slice(0, 7) : "";
}

export async function appendVatSalesAudit(input: {
  action: VatSalesAuditAction;
  dateKey?: string;
  monthKey?: string;
  summary: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  actor: string;
}): Promise<void> {
  const dateKey = String(input.dateKey || "").trim();
  const monthKey =
    String(input.monthKey || "").trim() ||
    (dateKey ? monthFromDateKey(dateKey) : "");
  const payload = {
    action: input.action,
    dateKey,
    monthKey,
    summary: String(input.summary || "").slice(0, 400),
    before: input.before || null,
    after: input.after || null,
    actor: String(input.actor || "").slice(0, 120),
    at: Date.now(),
  };
  try {
    await addDoc(collection(getDb(), VAT_SALES_AUDIT_COL), payload);
  } catch (e) {
    // ไม่ให้ audit พังงานหลัก
    console.warn("vatSalesAudit append failed", e);
  }
}

function mapEntry(id: string, data: Record<string, unknown>): VatSalesAuditEntry {
  return {
    id,
    action: (String(data.action || "upsert_day") as VatSalesAuditAction) || "upsert_day",
    dateKey: String(data.dateKey || ""),
    monthKey: String(data.monthKey || ""),
    summary: String(data.summary || ""),
    before: (data.before as Record<string, unknown> | null) || null,
    after: (data.after as Record<string, unknown> | null) || null,
    actor: String(data.actor || ""),
    at: Number(data.at) || 0,
  };
}

export async function listVatSalesAudit(opts?: {
  monthKey?: string;
  max?: number;
}): Promise<VatSalesAuditEntry[]> {
  const max = Math.min(200, Math.max(opts?.max || 80, 20));
  const snap = await getDocs(
    query(
      collection(getDb(), VAT_SALES_AUDIT_COL),
      orderBy("at", "desc"),
      limit(Math.min(300, max * 3)),
    ),
  );
  let rows = snap.docs.map((d) => mapEntry(d.id, d.data() as Record<string, unknown>));
  if (opts?.monthKey) {
    rows = rows.filter((r) => r.monthKey === opts.monthKey);
  }
  return rows.slice(0, max);
}

export function auditActionLabel(action: VatSalesAuditAction): string {
  switch (action) {
    case "upsert_day":
      return "แก้ยอดวัน";
    case "confirm_day":
      return "ยืนยันวัน";
    case "unconfirm_day":
      return "ปลดล็อกวัน";
    case "confirm_email":
      return "ยืนยันจากเมล";
    case "close_month":
      return "ปิดเดือน";
    case "prune_mail_raw":
      return "ลบ raw เมล";
    default:
      return action;
  }
}

/** snapshot เบา ๆ สำหรับ audit */
export function snapshotDailyAmounts(doc: {
  totalGross?: number;
  storefrontGross?: number;
  deliveryGross?: number;
  vatOutput?: number;
  status?: string;
  delivery?: {
    shopee?: { grossInclusive?: number };
    grab?: { grossInclusive?: number };
    lineman?: { grossInclusive?: number };
  };
}): Record<string, unknown> {
  return {
    status: doc.status || "draft",
    totalGross: doc.totalGross || 0,
    storefrontGross: doc.storefrontGross || 0,
    deliveryGross: doc.deliveryGross || 0,
    vatOutput: doc.vatOutput || 0,
    shopee: doc.delivery?.shopee?.grossInclusive || 0,
    grab: doc.delivery?.grab?.grossInclusive || 0,
    lineman: doc.delivery?.lineman?.grossInclusive || 0,
  };
}
