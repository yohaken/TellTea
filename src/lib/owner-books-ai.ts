import { httpsCallable } from "firebase/functions";
import {
  normalizeAiVatExtract,
  type AiVatExtract,
} from "./entry-vat";
import { getFirebaseFunctions } from "./firebase";
import { normalizeLedgerOutType } from "./ledger-ai";
import { normalizeAccountingDateKey } from "./utils";

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
} & AiVatExtract;

const ALLOWED = new Set(["cogs", "sga", "asset", "อื่นๆ"]);

/** Client → Cloud Function: อ่านใบเสร็จจากรูป (รวม VAT จากบิล) */
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
    Record<string, unknown>
  >(getFirebaseFunctions(), "extractOwnerBookFromReceipt", {
    // Per-image extract when transfer slip + tax invoice are attached.
    timeout: 180_000,
  });
  const result = await fn({
    imageRefs: refs,
    ...(opts?.model ? { model: opts.model } : {}),
  });
  const data = result.data || {};
  const type = normalizeLedgerOutType(String(data.type || "อื่นๆ"));
  if (!ALLOWED.has(type)) {
    throw new Error("AI ตอบประเภทไม่ถูกต้อง");
  }
  const amountOut = Number(data.amountOut);
  const vat = normalizeAiVatExtract(data);
  return {
    date: normalizeAccountingDateKey(String(data.date || "").trim()),
    description: String(data.description || "").trim(),
    amountOut: Number.isFinite(amountOut) && amountOut > 0 ? amountOut : null,
    type,
    note: String(data.note || "").trim(),
    reason: String(data.reason || "").trim(),
    model: String(data.model || ""),
    source: "ai",
    usedImages: Number(data.usedImages) || 0,
    ...vat,
  };
}
