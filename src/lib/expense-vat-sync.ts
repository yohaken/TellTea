/**
 * ผูก/ถอนแถวค่าใช้จ่าย ↔ vatInputInvoices (ภาษีซื้อ)
 * - sync เมื่อครบเงื่อนไข (มี VAT · ผู้ขาย · ในนาม · ใช้ขอคืนได้)
 * - ถอนเมื่อเงื่อนไขหลุด หรือลบแถวบช.
 */

import {
  buildExpenseVatPayerPayload,
  canSyncVatInputInvoice,
  normalizeExpenseVatPayer,
  shouldSyncVatInputInvoice,
  type ExpenseVatPayerFields,
} from "./expense-vat";
import { todayInputValue } from "./utils";
import {
  createVatInputInvoice,
  deleteVatInputInvoice,
  updateVatInputInvoice,
} from "./vat-input";

export type ExpenseVatSyncSource = {
  dateMs: number;
  amountOut: number;
  description: string;
  note?: string;
  /** รูปแรก evp:… หรือ URL */
  evidenceRef?: string;
  fields: Partial<ExpenseVatPayerFields>;
};

export type ExpenseVatSyncResult = {
  vatInputInvoiceId: string;
  action: "created" | "updated" | "removed" | "skipped";
  reason?: string;
};

/** ลบใบกำกับที่ลิงก์ไว้ (เงียบถ้าไม่มีสิทธิ์/ไม่พบ) */
export async function deleteLinkedVatInputInvoice(
  invoiceId: string | undefined | null,
): Promise<boolean> {
  const id = String(invoiceId || "").trim();
  if (!id) return false;
  try {
    await deleteVatInputInvoice(id);
    return true;
  } catch {
    return false;
  }
}

/**
 * สร้าง/อัปเดต หรือถอนใบกำกับภาษีซื้อตามสถานะแถว
 * — ต้องมีผู้ขายจริง (ไม่ใช้คำอธิบายรายการแทน)
 */
export async function reconcileExpenseVatInputInvoice(
  source: ExpenseVatSyncSource,
  by: string,
): Promise<ExpenseVatSyncResult> {
  const amountOut = Number(source.amountOut) || 0;
  const fields = buildExpenseVatPayerPayload(source.fields, amountOut);
  const existingId = fields.vatInputInvoiceId || "";
  const gate = canSyncVatInputInvoice(fields);

  if (!gate.ok) {
    if (existingId) {
      await deleteLinkedVatInputInvoice(existingId);
      return {
        vatInputInvoiceId: "",
        action: "removed",
        reason: gate.reason,
      };
    }
    return { vatInputInvoiceId: "", action: "skipped", reason: gate.reason };
  }

  if (!by.trim()) throw new Error("ไม่พบผู้บันทึกภาษีซื้อ");

  const dateKey = todayInputValue(new Date(source.dateMs || Date.now()));
  const vendor = fields.vendor.trim();
  const noteParts = [
    source.note,
    fields.taxInvoiceNo ? `เลขที่ ${fields.taxInvoiceNo}` : "",
    fields.invoiceName ? `ในนาม ${fields.invoiceName}` : "",
  ].filter((s) => String(s || "").trim());

  const payload = {
    dateKey,
    vendor,
    description: String(source.description || "").trim(),
    grossInclusive: amountOut,
    vatInput: fields.vatInput,
    evidenceRef: String(source.evidenceRef || "").trim(),
    note: noteParts.join(" · "),
  };

  if (existingId) {
    await updateVatInputInvoice(existingId, payload, by.trim());
    return { vatInputInvoiceId: existingId, action: "updated" };
  }

  const created = await createVatInputInvoice(payload, by.trim());
  return { vatInputInvoiceId: created.id, action: "created" };
}

/** @deprecated ใช้ reconcileExpenseVatInputInvoice */
export async function syncExpenseVatInputInvoice(
  source: ExpenseVatSyncSource,
  by: string,
): Promise<string> {
  const result = await reconcileExpenseVatInputInvoice(source, by);
  return result.vatInputInvoiceId;
}

/** รวมผล sync เข้าฟิลด์แถว */
export function withSyncedVatInputId(
  fields: ExpenseVatPayerFields,
  invoiceId: string,
): ExpenseVatPayerFields {
  const n = normalizeExpenseVatPayer(fields);
  return { ...n, vatInputInvoiceId: String(invoiceId || "").trim() };
}

export { shouldSyncVatInputInvoice, canSyncVatInputInvoice };
