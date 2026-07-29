/**
 * ผูกแถวค่าใช้จ่าย → vatInputInvoices (ภาษีซื้อ)
 * เรียกเมื่อเจ้าของบันทึก/รับบิล และแถวพร้อมขอคืน
 */

import {
  buildExpenseVatPayerPayload,
  normalizeExpenseVatPayer,
  shouldSyncVatInputInvoice,
  type ExpenseVatPayerFields,
} from "./expense-vat";
import { todayInputValue } from "./utils";
import {
  createVatInputInvoice,
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

/**
 * สร้างหรืออัปเดตใบกำกับภาษีซื้อ แล้วคืน vatInputInvoiceId
 * ถ้ายังไม่พร้อม sync คืน id เดิม (หรือ "")
 */
export async function syncExpenseVatInputInvoice(
  source: ExpenseVatSyncSource,
  by: string,
): Promise<string> {
  const amountOut = Number(source.amountOut) || 0;
  const fields = buildExpenseVatPayerPayload(source.fields, amountOut);
  if (!shouldSyncVatInputInvoice(fields)) {
    return fields.vatInputInvoiceId || "";
  }
  if (!by.trim()) throw new Error("ไม่พบผู้บันทึกภาษีซื้อ");

  const dateKey = todayInputValue(new Date(source.dateMs || Date.now()));
  const vendor =
    fields.vendor.trim() ||
    String(source.description || "").trim() ||
    "ไม่ระบุผู้ขาย";
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

  if (fields.vatInputInvoiceId) {
    await updateVatInputInvoice(fields.vatInputInvoiceId, payload, by.trim());
    return fields.vatInputInvoiceId;
  }

  const created = await createVatInputInvoice(payload, by.trim());
  return created.id;
}

/** รวมผล sync เข้าฟิลด์แถว */
export function withSyncedVatInputId(
  fields: ExpenseVatPayerFields,
  invoiceId: string,
): ExpenseVatPayerFields {
  const n = normalizeExpenseVatPayer(fields);
  return { ...n, vatInputInvoiceId: String(invoiceId || "").trim() };
}
