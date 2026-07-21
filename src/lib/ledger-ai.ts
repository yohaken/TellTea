import { httpsCallable } from "firebase/functions";
import { getFirebaseFunctions } from "./firebase";
import { guessTypeFromDescription } from "./ledger-labels";
import { listLedgerEntriesInMonth, updateLedgerEntry } from "./ledger";

export type LedgerTypeSource = "ai" | "owner" | "heuristic" | "legacy";

export type ClassifyLedgerTypeResult = {
  type: string;
  reason: string;
  model: string;
  source: "ai";
  usedImages: number;
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

/** Map stored typeSource — แถวเก่ไม่มี field = legacy (อย่าติดป้าย AI) */
export function resolveStoredTypeSource(raw: string | undefined | null): LedgerTypeSource {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "ai") return "ai";
  if (s === "owner") return "owner";
  if (s === "heuristic") return "heuristic";
  if (s === "legacy") return "legacy";
  return "legacy";
}

/** Client → Cloud Function (API key stays on server). */
export async function classifyLedgerTypeWithAi(
  description: string,
  opts?: { model?: string; imageUrls?: string[] },
): Promise<ClassifyLedgerTypeResult> {
  const text = description.trim();
  if (!text) {
    throw new Error("ต้องใส่ชื่อรายการ");
  }
  const imageUrls = (opts?.imageUrls || []).map((u) => u.trim()).filter(Boolean).slice(0, 2);
  const fn = httpsCallable<
    { description: string; model?: string; imageUrls?: string[] },
    ClassifyLedgerTypeResult
  >(getFirebaseFunctions(), "classifyLedgerType");
  const result = await fn({
    description: text,
    ...(opts?.model ? { model: opts.model } : {}),
    ...(imageUrls.length ? { imageUrls } : {}),
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
    usedImages: Number(data?.usedImages) || 0,
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

export type ReclassifyMonthProgress = {
  total: number;
  done: number;
  updated: number;
  skippedOwner: number;
  skippedIn: number;
  unchanged: number;
  failed: number;
  currentDescription?: string;
};

/**
 * จัดประเภทเงินออกใหม่ด้วย AI ทั้งเดือน — ข้ามรายการที่เจ้าของล็อกไว้
 */
export async function reclassifyLedgerMonthWithAi(
  year: number,
  month: number,
  opts?: {
    onProgress?: (p: ReclassifyMonthProgress) => void;
    /** ms ระหว่างแต่ละรายการ ลด rate-limit */
    delayMs?: number;
  },
): Promise<ReclassifyMonthProgress> {
  const rows = await listLedgerEntriesInMonth(year, month);
  const outs = rows.filter((r) => (Number(r.amountOut) || 0) > 0 && (r.description || "").trim());
  const progress: ReclassifyMonthProgress = {
    total: outs.length,
    done: 0,
    updated: 0,
    skippedOwner: 0,
    skippedIn: rows.length - outs.length,
    unchanged: 0,
    failed: 0,
  };
  opts?.onProgress?.({ ...progress });

  const delayMs = opts?.delayMs ?? 350;
  for (const row of outs) {
    progress.currentDescription = row.description;
    opts?.onProgress?.({ ...progress });

    if (resolveStoredTypeSource(row.typeSource) === "owner") {
      progress.skippedOwner += 1;
      progress.done += 1;
      opts?.onProgress?.({ ...progress });
      continue;
    }

    try {
      const result = await classifyLedgerTypeWithAi(row.description);
      const prevType = normalizeLedgerOutType(row.type || "");
      if (
        prevType === result.type &&
        resolveStoredTypeSource(row.typeSource) === "ai" &&
        (row.typeAiReason || "") === result.reason
      ) {
        progress.unchanged += 1;
      } else {
        await updateLedgerEntry(row.id, {
          type: result.type,
          typeSource: "ai",
          typeAiReason: result.reason,
        });
        progress.updated += 1;
      }
    } catch {
      progress.failed += 1;
    }

    progress.done += 1;
    opts?.onProgress?.({ ...progress });
    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  progress.currentDescription = undefined;
  opts?.onProgress?.({ ...progress });
  return progress;
}
