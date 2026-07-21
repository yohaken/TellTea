import { httpsCallable } from "firebase/functions";
import { getFirebaseFunctions } from "./firebase";
import { guessTypeFromDescription } from "./ledger-labels";

export type LedgerTypeSource = "ai" | "owner" | "heuristic";

export type ClassifyLedgerTypeResult = {
  type: string;
  reason: string;
  model: string;
  source: "ai";
};

const ALLOWED = new Set(["cogs", "sga", "asset", "อื่นๆ"]);

export function normalizeLedgerOutType(raw: string): string {
  const t = String(raw || "").trim();
  const lower = t.toLowerCase();
  if (lower === "cosg") return "cogs";
  if (lower === "assets") return "asset";
  if (lower === "other" || lower === "others") return "อื่นๆ";
  if (ALLOWED.has(lower)) return lower;
  if (t === "อื่นๆ") return "อื่นๆ";
  return t || "cogs";
}

/** Client → Cloud Function (API key stays on server). */
export async function classifyLedgerTypeWithAi(
  description: string,
  opts?: { model?: string },
): Promise<ClassifyLedgerTypeResult> {
  const text = description.trim();
  if (!text) {
    throw new Error("ต้องใส่ชื่อรายการ");
  }
  const fn = httpsCallable<
    { description: string; model?: string },
    ClassifyLedgerTypeResult
  >(getFirebaseFunctions(), "classifyLedgerType");
  const result = await fn({
    description: text,
    ...(opts?.model ? { model: opts.model } : {}),
  });
  const data = result.data;
  const type = normalizeLedgerOutType(data?.type || "");
  if (!ALLOWED.has(type) && type !== "อื่นๆ") {
    throw new Error("AI ตอบประเภทไม่ถูกต้อง");
  }
  return {
    type,
    reason: String(data?.reason || "").trim(),
    model: String(data?.model || ""),
    source: "ai",
  };
}

/** Fallback เมื่อ AI ใช้ไม่ได้ — keyword heuristic เดิม */
export function classifyLedgerTypeHeuristic(description: string) {
  const type = normalizeLedgerOutType(guessTypeFromDescription(description));
  return {
    type: ALLOWED.has(type) || type === "อื่นๆ" ? type : "cogs",
    reason: "เดาจากชื่อรายการ (สำรอง)",
    source: "heuristic" as const,
  };
}
