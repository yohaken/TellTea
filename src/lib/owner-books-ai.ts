import { httpsCallable } from "firebase/functions";
import {
  emptyExpenseVatPayer,
  normalizeExpenseVatPayer,
  type ExpenseInvoiceNameOk,
  type ExpenseVatMode,
  type ExpenseVatPayerFields,
} from "./expense-vat";
import { getFirebaseFunctions } from "./firebase";
import { normalizeLedgerOutType } from "./ledger-ai";

export type ExtractOwnerBookResult = {
  date: string;
  description: string;
  amountOut: number | null;
  type: string;
  note: string;
  reason: string;
  model: string;
  source: "ai";
  usedImages: number;
  vatMode: ExpenseVatMode;
  vatInput: number | null;
  vatBase: number | null;
  taxInvoiceNo: string;
  vendor: string;
  invoiceName: string;
  invoiceNameOk: ExpenseInvoiceNameOk;
};

const ALLOWED = new Set(["cogs", "sga", "asset", "อื่นๆ"]);
const VAT_MODES = new Set<ExpenseVatMode>(["unknown", "none", "inclusive"]);
const NAME_OK = new Set<ExpenseInvoiceNameOk>([
  "unknown",
  "ok",
  "mismatch",
  "no_invoice",
]);

function normalizeVatMode(raw: unknown): ExpenseVatMode {
  const s = String(raw || "unknown") as ExpenseVatMode;
  return VAT_MODES.has(s) ? s : "unknown";
}

function normalizeNameOk(raw: unknown): ExpenseInvoiceNameOk {
  const s = String(raw || "unknown") as ExpenseInvoiceNameOk;
  return NAME_OK.has(s) ? s : "unknown";
}

function normalizeOptionalMoney(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

/** รวมผล AI เข้าฟิลด์ VAT/ผู้จ่าย — ไม่ทับค่าที่คนกรอกแล้วถ้ามีรายละเอียด */
export function mergeExtractIntoExpenseVat(
  current: ExpenseVatPayerFields,
  extract: Pick<
    ExtractOwnerBookResult,
    | "vatMode"
    | "vatInput"
    | "vatBase"
    | "taxInvoiceNo"
    | "vendor"
    | "invoiceName"
    | "invoiceNameOk"
  >,
  opts?: { force?: boolean },
): ExpenseVatPayerFields {
  const cur = normalizeExpenseVatPayer(current);
  const force = !!opts?.force;
  const next = { ...cur };
  if (force || cur.vatMode === "unknown") {
    next.vatMode = normalizeVatMode(extract.vatMode);
  }
  if (force || !(cur.vatInput > 0)) {
    if (extract.vatInput != null) next.vatInput = extract.vatInput;
  }
  if (force || !(cur.vatBase > 0)) {
    if (extract.vatBase != null) next.vatBase = extract.vatBase;
  }
  if (force || !cur.taxInvoiceNo) {
    next.taxInvoiceNo = String(extract.taxInvoiceNo || "").trim();
  }
  if (force || !cur.vendor) {
    next.vendor = String(extract.vendor || "").trim();
  }
  if (force || !cur.invoiceName) {
    next.invoiceName = String(extract.invoiceName || "").trim();
  }
  if (force || cur.invoiceNameOk === "unknown") {
    next.invoiceNameOk = normalizeNameOk(extract.invoiceNameOk);
  }
  return normalizeExpenseVatPayer(next);
}

/** Client → Cloud Function: อ่านใบเสร็จจากรูป แล้วคืนฟิลด์บัญชีเข้าของ */
export async function extractOwnerBookFromReceipt(
  imageRefs: string[],
  opts?: { model?: string },
): Promise<ExtractOwnerBookResult> {
  const refs = imageRefs.map((u) => String(u || "").trim()).filter(Boolean).slice(0, 2);
  if (!refs.length) {
    throw new Error("ต้องมีรูปอย่างน้อย 1 รูป");
  }
  const fn = httpsCallable<
    { imageRefs: string[]; model?: string },
    ExtractOwnerBookResult
  >(getFirebaseFunctions(), "extractOwnerBookFromReceipt");
  const result = await fn({
    imageRefs: refs,
    ...(opts?.model ? { model: opts.model } : {}),
  });
  const data = result.data;
  const type = normalizeLedgerOutType(data?.type || "อื่นๆ");
  if (!ALLOWED.has(type)) {
    throw new Error("AI ตอบประเภทไม่ถูกต้อง");
  }
  const amountOut = Number(data?.amountOut);
  return {
    date: String(data?.date || "").trim(),
    description: String(data?.description || "").trim(),
    amountOut: Number.isFinite(amountOut) && amountOut > 0 ? amountOut : null,
    type,
    note: String(data?.note || "").trim(),
    reason: String(data?.reason || "").trim(),
    model: String(data?.model || ""),
    source: "ai",
    usedImages: Number(data?.usedImages) || 0,
    vatMode: normalizeVatMode(data?.vatMode),
    vatInput: normalizeOptionalMoney(data?.vatInput),
    vatBase: normalizeOptionalMoney(data?.vatBase),
    taxInvoiceNo: String(data?.taxInvoiceNo || "").trim(),
    vendor: String(data?.vendor || "").trim(),
    invoiceName: String(data?.invoiceName || "").trim(),
    invoiceNameOk: normalizeNameOk(data?.invoiceNameOk),
  };
}

export { emptyExpenseVatPayer };
