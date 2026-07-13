/** บันทึกใบเสร็จบนเครื่อง (POS อ่าน posSales จาก Firestore ไม่ได้) */
import type { PosSaleLine, PosSalePaymentMethod } from "./types";

export type PosLocalReceiptLine = {
  name: string;
  qty: number;
  unitPrice: number;
  options: { groupName: string; choiceNames: string[] }[];
};

export type PosLocalReceipt = {
  id: string;
  billNo: string;
  sessionId?: string;
  total: number;
  paymentMethod: PosSalePaymentMethod;
  linePreview: string;
  lines?: PosLocalReceiptLine[];
  cashReceived?: number;
  change?: number;
  createdAt: number;
  pending: boolean;
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
  const cash = receipts.filter((r) => r.paymentMethod === "cash");
  const pp = receipts.filter((r) => r.paymentMethod === "promptpay");
  return {
    count: receipts.length,
    total: Math.round(receipts.reduce((s, r) => s + r.total, 0) * 100) / 100,
    cashTotal: Math.round(cash.reduce((s, r) => s + r.total, 0) * 100) / 100,
    cashCount: cash.length,
    promptpayTotal: Math.round(pp.reduce((s, r) => s + r.total, 0) * 100) / 100,
    promptpayCount: pp.length,
    pendingCount: receipts.filter((r) => r.pending).length,
  };
}

export function markLocalReceiptSynced(clientMutationId: string, billNo: string) {
  const all = readAll();
  const idx = all.findIndex((r) => r.id === clientMutationId);
  if (idx < 0) return;
  all[idx] = { ...all[idx]!, billNo, pending: false };
  writeAll(all);
}
