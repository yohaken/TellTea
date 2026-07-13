/** Shared sync helpers — safe to import from Node tests. */

import type { PosOutboxEntry, PosSaleMutationPayload } from "./pos-sync-types";

/** Alert owner when pending bills age past this (ms). */
export const POS_SYNC_STUCK_MS = 5 * 60 * 1000;

export function saleTotalFromPayload(payload: PosSaleMutationPayload): number {
  const subtotal = payload.lines.reduce((sum, l) => sum + l.price * l.qty, 0);
  return Math.round(subtotal * 100) / 100;
}

export function outboxEntryStatus(entry: PosOutboxEntry): "pending" | "failed" {
  return entry.status === "failed" ? "failed" : "pending";
}

export function isOutboxEntryStuck(entry: PosOutboxEntry, now = Date.now()): boolean {
  if (outboxEntryStatus(entry) === "failed") return false;
  return now - entry.createdAt >= POS_SYNC_STUCK_MS || entry.attempts >= 5;
}

export function linePreviewFromPayload(payload: PosSaleMutationPayload): string {
  const preview = payload.lines
    .slice(0, 2)
    .map((l) => `${l.name}×${l.qty}`)
    .join(", ");
  const more = payload.lines.length > 2 ? ` +${payload.lines.length - 2}` : "";
  return preview + more;
}

export function createPosMutationId(deviceId: string): string {
  const tail =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${deviceId.slice(0, 12)}-${tail}`;
}

export function formatPendingBillNo(clientMutationId: string): string {
  const short = clientMutationId.replace(/[^a-zA-Z0-9]/g, "").slice(-6).toUpperCase();
  return `รอส่ง-${short || "LOCAL"}`;
}

export function isRetryableSaleError(err: unknown): boolean {
  const code = (err as { code?: string })?.code || "";
  const message = (err as Error)?.message || "";
  if (code === "functions/invalid-argument" || code === "functions/permission-denied") {
    return false;
  }
  if (code === "functions/unavailable" || code === "functions/deadline-exceeded") {
    return true;
  }
  if (code === "functions/internal") return true;
  if (/network|fetch|failed to fetch|offline|unavailable/i.test(message)) return true;
  return false;
}

export function isBrowserOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

export type SessionPendingOverlayInput = {
  sessionId: string;
  total: number;
  status: "pending" | "failed";
};

/** Pending outbox bills for one session — avoids double-counting once server syncs. */
export function computeSessionPendingOverlay(
  sessionId: string,
  bills: SessionPendingOverlayInput[],
): { extraSaleCount: number; extraTotalSales: number } {
  const pending = bills.filter((b) => b.sessionId === sessionId && b.status === "pending");
  const extraTotalSales = pending.reduce((sum, b) => sum + b.total, 0);
  return {
    extraSaleCount: pending.length,
    extraTotalSales: Math.round(extraTotalSales * 100) / 100,
  };
}
