import { httpsCallable } from "firebase/functions";
import { getFirebaseFunctions } from "./firebase";
import { guessTypeFromDescriptionStrict, canonicalLedgerType } from "./ledger-labels";
import { updateLedgerEntry } from "./ledger";
import type { LedgerEntry } from "./types";

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
  const key = canonicalLedgerType(raw);
  if (ALLOWED.has(key)) return key;
  return key || "cogs";
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
  let result: Awaited<ReturnType<typeof fn>>;
  try {
    result = await fn({
      description: text,
      ...(opts?.model ? { model: opts.model } : {}),
      ...(imageUrls.length ? { imageUrls } : {}),
    });
  } catch (err) {
    console.warn("[classifyLedgerType] AI failed — caller falls back to heuristic", err);
    throw err;
  }
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

/** ประเภทที่ได้มาพร้อมการอ่านบิล — ใช้แทนการเรียก AI จัดประเภทซ้ำตอนบันทึก */
export type BillTypeHint = { type: string; reason: string; description: string };

/**
 * สลิปโอนอย่างเดียวไม่บอกว่าซื้ออะไร และ «อื่นๆ» = AI ไม่แน่ใจ → ไม่ใช้ (ให้จัดจากชื่อรายการแทน)
 */
export function billTypeHintFromExtract(
  result: { type: string; reason: string; docKind: string; slipOnly: boolean },
  description: string,
): BillTypeHint | null {
  if (result.slipOnly || result.docKind === "bank_slip") return null;
  const type = normalizeLedgerOutType(result.type);
  if (!ALLOWED.has(type) || type === "อื่นๆ") return null;
  const desc = description.trim();
  if (!desc) return null;
  return { type, reason: result.reason || "อ่านจากรูปใบเสร็จ", description: desc };
}

/**
 * ค่าช่องหลังอ่านบิล: บิลเป็นค่าเริ่มต้น (อ่านรอบใหม่/เพิ่มรูปก็เติมใหม่)
 * ยกเว้นผู้ใช้พิมพ์เองแล้ว · onlyIfEmpty = แก้รายการเดิม หรือมีแต่รูปสินค้า (ไม่ใช่บิล) — เติมเฉพาะช่องว่าง
 */
export function billFieldValue(
  current: string,
  fromBill: string | number | null | undefined,
  opts: { typedByUser: boolean; onlyIfEmpty?: boolean },
): string {
  const bill = fromBill == null ? "" : String(fromBill).trim();
  if (!bill) return current;
  if (!current.trim()) return bill;
  if (opts.onlyIfEmpty || opts.typedByUser) return current;
  return bill;
}

/**
 * ชื่อจากเอกสารทับชื่อเดิมได้เฉพาะใบเสร็จ/ใบกำกับ/ใบแจ้งค่าน้ำไฟ
 * สลิป · รูปสินค้า · อื่นๆ = AI เดาจากภาพ (เคยอ่านมันเป็นกล้วย) → เติมเฉพาะช่องว่าง
 */
export function isBillNameSource(result: { docKind: string; slipOnly: boolean; goodsOnly: boolean }) {
  if (result.slipOnly || result.goodsOnly) return false;
  return result.docKind === "tax_invoice" || result.docKind === "utility_bill";
}

/** ใช้ได้เฉพาะเมื่อชื่อรายการยังเหมือนตอนอ่านบิล */
export function usableBillTypeHint(
  hint: BillTypeHint | null,
  description: string,
): BillTypeHint | null {
  return hint && hint.description === description.trim() ? hint : null;
}

/** Fallback เมื่อ AI ใช้ไม่ได้ — keyword heuristic เดิม */
export function classifyLedgerTypeHeuristic(description: string) {
  const matched = guessTypeFromDescriptionStrict(description);
  const type = matched ? normalizeLedgerOutType(matched) : "";
  if (type && ALLOWED.has(type)) {
    return {
      type,
      reason: "เดาจากชื่อรายการ (AI ไม่ตอบ) — รอ AI/เจ้าของจัดใหม่",
      source: "heuristic" as const,
    };
  }
  // ต้องมี type ไว้ก่อนเพื่อให้ P&L นับยอด — ป้าย «เดา» บอกให้จัดใหม่
  return {
    type: "cogs",
    reason: "เดาไม่ได้ (AI ไม่ตอบ) — ตั้งต้นทุนไว้ชั่วคราว รอ AI/เจ้าของจัดใหม่",
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

export type LedgerTypeChange = {
  id: string;
  date: number;
  beforeType: string;
  beforeSource: string;
  afterType: string;
  reason: string;
};

/**
 * จัดประเภทเงินออกด้วย AI เฉพาะแถวที่ส่งมา — ข้ามแถวที่เจ้าของจัดเอง และแถวเงินเข้า
 * คืนรายการที่เปลี่ยนไว้ทำ audit
 */
export async function reclassifyLedgerRowsWithAi(
  rows: Pick<LedgerEntry, "id" | "date" | "description" | "amountOut" | "type" | "typeSource" | "typeAiReason">[],
  opts?: {
    onProgress?: (p: ReclassifyMonthProgress) => void;
    /** เรียกทันทีหลังบันทึกแต่ละแถว — ให้ UI อัปเดตเซลล์โดยไม่รอจบทั้งชุด */
    onRowChanged?: (change: LedgerTypeChange) => void;
    shouldCancel?: () => boolean;
    delayMs?: number;
  },
): Promise<{ progress: ReclassifyMonthProgress; changes: LedgerTypeChange[]; cancelled: boolean }> {
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
  const changes: LedgerTypeChange[] = [];
  const delayMs = opts?.delayMs ?? 350;
  let cancelled = false;
  opts?.onProgress?.({ ...progress });

  for (const row of outs) {
    if (opts?.shouldCancel?.()) {
      cancelled = true;
      break;
    }
    progress.currentDescription = row.description;
    opts?.onProgress?.({ ...progress });

    const prevSource = resolveStoredTypeSource(row.typeSource);
    // เงินเดือนจากหน้า payroll ตั้งประเภทเองแล้ว — นับรวมกับที่เจ้าของจัด
    if (prevSource === "owner" || String(row.typeSource || "").trim().startsWith("payroll")) {
      progress.skippedOwner += 1;
      progress.done += 1;
      opts?.onProgress?.({ ...progress });
      continue;
    }

    try {
      const result = await classifyLedgerTypeWithAi(row.description);
      const prevType = normalizeLedgerOutType(row.type || "");
      if (prevType === result.type && prevSource === "ai" && (row.typeAiReason || "") === result.reason) {
        progress.unchanged += 1;
      } else {
        await updateLedgerEntry(row.id, {
          type: result.type,
          typeSource: "ai",
          typeAiReason: result.reason,
        });
        const change: LedgerTypeChange = {
          id: row.id,
          date: row.date,
          beforeType: row.type || "",
          beforeSource: String(row.typeSource || ""),
          afterType: result.type,
          reason: result.reason,
        };
        changes.push(change);
        opts?.onRowChanged?.(change);
        progress.updated += 1;
      }
    } catch {
      progress.failed += 1;
    }

    progress.done += 1;
    opts?.onProgress?.({ ...progress });
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }

  progress.currentDescription = undefined;
  opts?.onProgress?.({ ...progress });
  return { progress, changes, cancelled };
}
