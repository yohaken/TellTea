/**
 * Append-only audit for ledger category changes (owner-only tools).
 */

import { addDoc, collection } from "firebase/firestore";
import { getDb } from "./firebase";

export const LEDGER_AUDIT_COL = "ledgerAudit";

export type LedgerAuditAction = "bulk_set_type" | "ai_reclassify" | "edit_type";

export type LedgerAuditItem = {
  id: string;
  monthKey: string;
  beforeType: string;
  beforeSource: string;
  afterType: string;
  afterSource: string;
};

/** แยกเป็นหลาย doc กันขนาดเกิน 1 MB */
const ITEMS_PER_DOC = 400;

export async function appendLedgerAudit(input: {
  action: LedgerAuditAction;
  items: LedgerAuditItem[];
  actor: string;
  closedMonthOverride?: boolean;
  closedMonths?: string[];
  summary?: string;
}): Promise<void> {
  const items = input.items.filter((i) => i.id);
  if (!items.length) return;
  const at = Date.now();
  try {
    for (let i = 0; i < items.length; i += ITEMS_PER_DOC) {
      const chunk = items.slice(i, i + ITEMS_PER_DOC);
      await addDoc(collection(getDb(), LEDGER_AUDIT_COL), {
        action: input.action,
        summary: String(input.summary || "").slice(0, 400),
        count: chunk.length,
        monthKeys: [...new Set(chunk.map((c) => c.monthKey).filter(Boolean))].sort(),
        items: chunk,
        closedMonthOverride: Boolean(input.closedMonthOverride),
        closedMonths: input.closedMonths || [],
        actor: String(input.actor || "").slice(0, 120),
        at,
      });
    }
  } catch (e) {
    // ไม่ให้ audit พังงานหลัก
    console.warn("ledgerAudit append failed", e);
  }
}
