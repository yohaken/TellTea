/**
 * VAT ซื้อ + ผู้จ่าย ต่อแถวค่าใช้จ่าย (แจ้งบิล / บช.เจ้าของ / ledger ต่อไป)
 * แยกจากยอดจ่าย — ใช้ขอคืนภาษีซื้อและเช็คชื่อบนเอกสาร
 */

import { computeVatFromGross, normalizeMoney, roundMoney } from "./vat-sales";

export type ExpenseVatMode = "unknown" | "none" | "inclusive";
export type ExpensePayer = "" | "shop" | "owner" | "staff" | "other";
export type ExpenseInvoiceNameOk =
  | "unknown"
  | "ok"
  | "mismatch"
  | "no_invoice";

export type ExpenseVatPayerFields = {
  vatMode: ExpenseVatMode;
  vatBase: number;
  vatInput: number;
  taxInvoiceNo: string;
  payer: ExpensePayer;
  /** ผู้ขาย / ร้านบนใบกำกับ */
  vendor: string;
  /** ใบกำกับออกในนาม (ผู้ซื้อ) */
  invoiceName: string;
  invoiceNameOk: ExpenseInvoiceNameOk;
  /** ลิงก์ไป vatInputInvoices/{id} เมื่อ sync แล้ว */
  vatInputInvoiceId: string;
};

const VAT_MODES = new Set<ExpenseVatMode>(["unknown", "none", "inclusive"]);
const PAYERS = new Set<ExpensePayer>(["", "shop", "owner", "staff", "other"]);
const NAME_OK = new Set<ExpenseInvoiceNameOk>([
  "unknown",
  "ok",
  "mismatch",
  "no_invoice",
]);

export function emptyExpenseVatPayer(): ExpenseVatPayerFields {
  return {
    vatMode: "unknown",
    vatBase: 0,
    vatInput: 0,
    taxInvoiceNo: "",
    payer: "",
    vendor: "",
    invoiceName: "",
    invoiceNameOk: "unknown",
    vatInputInvoiceId: "",
  };
}

export function normalizeExpenseVatPayer(
  raw?: Partial<ExpenseVatPayerFields> | Record<string, unknown> | null,
): ExpenseVatPayerFields {
  const base = emptyExpenseVatPayer();
  if (!raw || typeof raw !== "object") return base;
  const modeRaw = String((raw as ExpenseVatPayerFields).vatMode || "unknown");
  const payerRaw = String((raw as ExpenseVatPayerFields).payer || "") as ExpensePayer;
  const okRaw = String(
    (raw as ExpenseVatPayerFields).invoiceNameOk || "unknown",
  ) as ExpenseInvoiceNameOk;
  return {
    vatMode: VAT_MODES.has(modeRaw as ExpenseVatMode)
      ? (modeRaw as ExpenseVatMode)
      : "unknown",
    vatBase: normalizeMoney((raw as ExpenseVatPayerFields).vatBase),
    vatInput: normalizeMoney((raw as ExpenseVatPayerFields).vatInput),
    taxInvoiceNo: String((raw as ExpenseVatPayerFields).taxInvoiceNo || "").trim(),
    payer: PAYERS.has(payerRaw) ? payerRaw : "",
    vendor: String((raw as ExpenseVatPayerFields).vendor || "").trim(),
    invoiceName: String((raw as ExpenseVatPayerFields).invoiceName || "").trim(),
    invoiceNameOk: NAME_OK.has(okRaw) ? okRaw : "unknown",
    vatInputInvoiceId: String(
      (raw as ExpenseVatPayerFields).vatInputInvoiceId || "",
    ).trim(),
  };
}

/** เมื่อ inclusive + ยอดรวม → คำนวณฐาน/VAT จาก 7/107 (ทับค่าเดิม) */
export function expenseVatFromGross(amountOut: number): Pick<
  ExpenseVatPayerFields,
  "vatBase" | "vatInput"
> {
  const { vatBase, vatOutput } = computeVatFromGross(amountOut);
  return { vatBase, vatInput: vatOutput };
}

/**
 * สร้าง payload บันทึก — ถ้า inclusive และยังไม่ใส่ VAT เอง จะคิดจากยอด
 * ถ้า none/unknown เคลียร์ฐาน/VAT เป็น 0
 */
export function buildExpenseVatPayerPayload(
  input: Partial<ExpenseVatPayerFields> | null | undefined,
  amountOut: number,
): ExpenseVatPayerFields {
  const n = normalizeExpenseVatPayer(input);
  if (n.vatMode === "inclusive") {
    const hasManual = n.vatInput > 0 || n.vatBase > 0;
    if (!hasManual && amountOut > 0) {
      const calc = expenseVatFromGross(amountOut);
      return { ...n, ...calc };
    }
    return {
      ...n,
      vatBase: roundMoney(n.vatBase),
      vatInput: roundMoney(n.vatInput),
    };
  }
  return {
    ...n,
    vatBase: 0,
    vatInput: 0,
  };
}

export function labelExpenseVatMode(mode: ExpenseVatMode): string {
  switch (mode) {
    case "none":
      return "ไม่มี VAT";
    case "inclusive":
      return "มี VAT ในยอด";
    default:
      return "ไม่แน่ใจ";
  }
}

export function labelExpensePayer(payer: ExpensePayer): string {
  switch (payer) {
    case "shop":
      return "ร้านจ่าย";
    case "owner":
      return "เจ้าของจ่าย";
    case "staff":
      return "พนักงานจ่าย";
    case "other":
      return "อื่น";
    default:
      return "ไม่ระบุ";
  }
}

export function labelExpenseInvoiceNameOk(ok: ExpenseInvoiceNameOk): string {
  switch (ok) {
    case "ok":
      return "ใช้ขอคืนได้";
    case "mismatch":
      return "ชื่อไม่ตรง";
    case "no_invoice":
      return "ไม่มีใบกำกับ";
    default:
      return "ยังไม่เช็ค";
  }
}

/** ชิปสั้นในแถวตาราง — ไม่ยืดสูง */
export function shortExpenseVatHint(fields: ExpenseVatPayerFields): string {
  const n = normalizeExpenseVatPayer(fields);
  if (n.vatMode === "inclusive") {
    return n.vatInput > 0 ? `VAT ${roundMoney(n.vatInput)}` : "VAT";
  }
  if (n.vatMode === "none") return "ไม่มี";
  return "";
}

export function shortExpensePayerHint(fields: ExpenseVatPayerFields): string {
  const n = normalizeExpenseVatPayer(fields);
  if (!n.payer) return "";
  switch (n.payer) {
    case "shop":
      return "ร้าน";
    case "owner":
      return "เจ้าของ";
    case "staff":
      return "พนง.";
    default:
      return "อื่น";
  }
}

/** บรรทัดสรุปบนหัวกล่องหุบ */
export function expenseVatFoldSummary(fields: ExpenseVatPayerFields): string {
  const n = normalizeExpenseVatPayer(fields);
  const parts: string[] = [labelExpenseVatMode(n.vatMode)];
  if (n.vatMode === "inclusive" && n.vatInput > 0) {
    parts.push(`VAT ${roundMoney(n.vatInput)}`);
  }
  if (n.vendor) parts.push(n.vendor);
  if (n.payer) parts.push(labelExpensePayer(n.payer));
  if (n.invoiceName) parts.push(`ในนาม ${n.invoiceName}`);
  if (n.invoiceNameOk !== "unknown") {
    parts.push(labelExpenseInvoiceNameOk(n.invoiceNameOk));
  }
  if (n.vatInputInvoiceId) parts.push("ลิงก์ภาษีซื้อแล้ว");
  return parts.join(" · ");
}

export function hasExpenseVatPayerDetail(fields: ExpenseVatPayerFields): boolean {
  const n = normalizeExpenseVatPayer(fields);
  return (
    n.vatMode !== "unknown" ||
    !!n.payer ||
    !!n.vendor.trim() ||
    !!n.invoiceName.trim() ||
    !!n.taxInvoiceNo.trim() ||
    n.invoiceNameOk !== "unknown" ||
    n.vatInput > 0 ||
    !!n.vatInputInvoiceId
  );
}

/**
 * พร้อมลิงก์ภาษีซื้อ — ต้องครบ: มี VAT · ผู้ขาย · ในนาม · ยืนยันใช้ขอคืนได้
 * (กันสร้างใบที่สรรพากรไม่รับจากข้อมูลครึ่งๆ)
 */
export function canSyncVatInputInvoice(
  fields: ExpenseVatPayerFields,
): { ok: true } | { ok: false; reason: string } {
  const n = normalizeExpenseVatPayer(fields);
  if (n.vatMode !== "inclusive") {
    return { ok: false, reason: "ยังไม่ใช่บิลมี VAT" };
  }
  if (!(n.vatInput > 0)) {
    return { ok: false, reason: "ใส่ยอด VAT ก่อน" };
  }
  if (!n.vendor.trim()) {
    return { ok: false, reason: "ใส่ชื่อผู้ขายก่อนลิงก์ภาษีซื้อ" };
  }
  if (!n.invoiceName.trim()) {
    return { ok: false, reason: "ใส่ชื่อในนามก่อนลิงก์ภาษีซื้อ" };
  }
  if (n.invoiceNameOk !== "ok") {
    return { ok: false, reason: "ยืนยัน «ใช้ขอคืนได้» หลังเช็คชื่อบนบิล" };
  }
  return { ok: true };
}

export function shouldSyncVatInputInvoice(fields: ExpenseVatPayerFields): boolean {
  return canSyncVatInputInvoice(fields).ok;
}
