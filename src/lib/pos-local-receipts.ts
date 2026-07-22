/** บันทึกใบเสร็จบนเครื่อง (POS อ่าน posSales จาก Firestore ไม่ได้) */
import type { PosSaleLine, PosSalePaymentMethod } from "./types";
import { reverseBestsellerSaleLines } from "./pos-bestseller-local";

export type PosLocalReceiptLine = {
  name: string;
  qty: number;
  unitPrice: number;
  options: { groupName: string; choiceNames: string[] }[];
  /** สำหรับแยกหมวดในรายงานปิดกะ */
  menuItemId?: string;
  categoryName?: string;
};

export type PosLocalReceipt = {
  id: string;
  billNo: string;
  sessionId?: string;
  total: number;
  paymentMethod: PosSalePaymentMethod;
  linePreview: string;
  lines?: PosLocalReceiptLine[];
  /** ส่วนลดท้ายบิล (บาท) — เก็บเพื่อสรุปปิดกะ */
  discountBaht?: number;
  cashReceived?: number;
  change?: number;
  createdAt: number;
  pending: boolean;
  voided?: boolean;
  voidedAt?: number;
  voidReason?: string;
};

const KEY = "telltea-pos-local-receipts";
const MAX = 200;

function readAll(): PosLocalReceipt[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PosLocalReceipt[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** @internal demo seed */
export function readAllLocalReceipts(): PosLocalReceipt[] {
  return readAll();
}

/** @internal demo seed */
export function writeAllLocalReceipts(rows: PosLocalReceipt[]) {
  writeAll(rows);
}

function writeAll(rows: PosLocalReceipt[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(rows.slice(-MAX)));
}

export function saleLinesToLocalReceiptLines(lines: PosSaleLine[]): PosLocalReceiptLine[] {
  return lines.map((line) => {
    const paren = line.name.indexOf(" (");
    const baseName = paren > 0 ? line.name.slice(0, paren).trim() : line.name.trim();
    return {
      name: baseName,
      qty: line.qty,
      unitPrice: line.price,
      menuItemId: line.menuItemId || undefined,
      options: (line.options || []).map((g) => ({
        groupName: g.groupName,
        choiceNames: g.choices.map((c) => c.name),
      })),
    };
  });
}

export function appendLocalReceipt(row: PosLocalReceipt) {
  const all = readAll();
  all.push(row);
  writeAll(all);
}

export function listLocalReceiptsForDay(dayStartMs: number): PosLocalReceipt[] {
  const dayEnd = dayStartMs + 86_400_000;
  return readAll()
    .filter((r) => r.createdAt >= dayStartMs && r.createdAt < dayEnd)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function listLocalReceiptsRecent(days = 7): PosLocalReceipt[] {
  const cutoff = Date.now() - days * 86_400_000;
  return readAll()
    .filter((r) => r.createdAt >= cutoff)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function listLocalReceiptsForSession(sessionId: string): PosLocalReceipt[] {
  return readAll()
    .filter((r) => r.sessionId === sessionId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function summarizeLocalReceipts(receipts: PosLocalReceipt[]) {
  const active = receipts.filter((r) => !r.voided);
  const cash = active.filter((r) => r.paymentMethod === "cash");
  const pp = active.filter((r) => r.paymentMethod === "promptpay");

  const discOf = (r: PosLocalReceipt) => {
    const stored = Math.max(0, Math.round(Number(r.discountBaht || 0) * 100) / 100);
    if (stored > 0) return stored;
    if (!r.lines?.length) return 0;
    const sub =
      Math.round(r.lines.reduce((s, l) => s + l.unitPrice * l.qty, 0) * 100) / 100;
    const diff = Math.round((sub - r.total) * 100) / 100;
    return diff > 0.004 ? diff : 0;
  };

  const discountTotal = Math.round(active.reduce((s, r) => s + discOf(r), 0) * 100) / 100;
  const discountCount = active.filter((r) => discOf(r) > 0).length;
  const netTotal = Math.round(active.reduce((s, r) => s + r.total, 0) * 100) / 100;
  const grossTotal = Math.round((netTotal + discountTotal) * 100) / 100;
  return {
    count: active.length,
    total: netTotal,
    grossTotal,
    discountTotal,
    discountCount,
    cashTotal: Math.round(cash.reduce((s, r) => s + r.total, 0) * 100) / 100,
    cashCount: cash.length,
    promptpayTotal: Math.round(pp.reduce((s, r) => s + r.total, 0) * 100) / 100,
    promptpayCount: pp.length,
    pendingCount: active.filter((r) => r.pending).length,
    voidedCount: receipts.filter((r) => r.voided).length,
  };
}

export function voidLocalReceipt(id: string, reason?: string): boolean {
  const all = readAll();
  const idx = all.findIndex((r) => r.id === id);
  if (idx < 0 || all[idx]!.voided) return false;
  const prev = all[idx]!;
  if (prev.lines?.length) {
    reverseBestsellerSaleLines(
      prev.lines.map((l) => ({ menuItemId: l.menuItemId, qty: l.qty })),
    );
  }
  all[idx] = {
    ...prev,
    voided: true,
    voidedAt: Date.now(),
    voidReason: reason?.trim() || "ทำลายบิล",
    pending: false,
  };
  writeAll(all);
  return true;
}

export function markLocalReceiptSynced(clientMutationId: string, billNo: string) {
  const all = readAll();
  const idx = all.findIndex((r) => r.id === clientMutationId);
  if (idx < 0) return;
  all[idx] = { ...all[idx]!, billNo, pending: false };
  writeAll(all);
}
