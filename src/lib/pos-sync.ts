import { httpsCallable } from "firebase/functions";
import { reportPosDeviceSyncStatus } from "./pos-devices";
import { getPosFirebaseAuth, getPosFirebaseFunctions } from "./pos-firebase";
import {
  bumpOutboxAttempt,
  listOutboxEntries,
  markOutboxFailed,
  removeOutboxEntry,
  resetOutboxForRetry,
} from "./pos-outbox";
import type { PosOutboxBillView, PosSaleMutationPayload, PosSaleResult } from "./pos-sync-types";
import {
  formatPendingBillNo,
  isOutboxEntryStuck,
  isRetryableSaleError,
  linePreviewFromPayload,
  outboxEntryStatus,
  saleTotalFromPayload,
} from "./pos-sync-utils";

type CfSaleResult = { saleId: string; billNo: string; change: number; total: number };

export async function invokePosCompleteSale(payload: PosSaleMutationPayload): Promise<CfSaleResult> {
  const user = getPosFirebaseAuth().currentUser;
  if (user) await user.getIdToken(true);
  const authUid = user?.uid || payload.deviceId;
  const posCompleteSale = httpsCallable<PosSaleMutationPayload, CfSaleResult>(
    getPosFirebaseFunctions(),
    "posCompleteSale",
  );
  const result = await posCompleteSale({ ...payload, deviceId: authUid });
  const data = result.data;
  if (!data?.saleId || !data?.billNo) {
    throw Object.assign(new Error("บันทึกการขาย — ตอบกลับไม่สมบูรณ์"), {
      code: "functions/internal",
    });
  }
  return data;
}

function mapOutboxViews(entries: Awaited<ReturnType<typeof listOutboxEntries>>): PosOutboxBillView[] {
  const now = Date.now();
  return entries.map((entry) => ({
    id: entry.id,
    billNo: formatPendingBillNo(entry.id),
    total: saleTotalFromPayload(entry.payload),
    paymentMethod: entry.payload.paymentMethod,
    shift: entry.payload.shift,
    linePreview: linePreviewFromPayload(entry.payload),
    createdAt: entry.createdAt,
    attempts: entry.attempts,
    status: outboxEntryStatus(entry),
    lastError: entry.lastError,
    stuck: isOutboxEntryStuck(entry, now),
  }));
}

async function publishDeviceSyncStatus(entries: Awaited<ReturnType<typeof listOutboxEntries>>) {
  const uid = getPosFirebaseAuth().currentUser?.uid;
  if (!uid) return;

  const pending = entries.filter((e) => outboxEntryStatus(e) === "pending");
  const failed = entries.filter((e) => outboxEntryStatus(e) === "failed");
  const stuckEntries = pending.filter((e) => isOutboxEntryStuck(e));
  const syncStuckAt =
    stuckEntries.length > 0 ? Math.min(...stuckEntries.map((e) => e.createdAt)) : 0;
  const syncLastError =
    failed[0]?.lastError || pending.find((e) => e.lastError)?.lastError || "";

  try {
    await reportPosDeviceSyncStatus(uid, {
      syncPendingCount: pending.length,
      syncFailedCount: failed.length,
      syncStuckAt,
      syncLastError: syncLastError.slice(0, 240),
    });
  } catch {
    // Non-blocking — heartbeat path still works
  }
}

export async function flushPosOutbox(): Promise<{ synced: number; remaining: number }> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    const remaining = (await listOutboxEntries()).length;
    return { synced: 0, remaining };
  }

  const entries = await listOutboxEntries();
  let synced = 0;

  for (const entry of entries) {
    if (outboxEntryStatus(entry) === "failed") continue;

    try {
      await invokePosCompleteSale(entry.payload);
      await removeOutboxEntry(entry.id);
      synced += 1;
    } catch (err) {
      const message = (err as Error).message || "ส่งไม่สำเร็จ";
      if (!isRetryableSaleError(err)) {
        await markOutboxFailed(entry.id, message);
        continue;
      }
      await bumpOutboxAttempt(entry.id, message);
      break;
    }
  }

  const remaining = (await listOutboxEntries()).length;
  return { synced, remaining };
}

export type PosSyncSnapshot = {
  pendingCount: number;
  failedCount: number;
  stuckCount: number;
  syncing: boolean;
  lastFlushAt: number;
  lastSynced: number;
  bills: PosOutboxBillView[];
};

const listeners = new Set<(snap: PosSyncSnapshot) => void>();
let snapshot: PosSyncSnapshot = {
  pendingCount: 0,
  failedCount: 0,
  stuckCount: 0,
  syncing: false,
  lastFlushAt: 0,
  lastSynced: 0,
  bills: [],
};
let flushing = false;

function emit() {
  for (const fn of listeners) fn(snapshot);
}

export function subscribePosSync(listener: (snap: PosSyncSnapshot) => void): () => void {
  listeners.add(listener);
  listener(snapshot);
  return () => listeners.delete(listener);
}

export async function refreshPosSyncSnapshot(): Promise<PosSyncSnapshot> {
  const entries = await listOutboxEntries();
  const bills = mapOutboxViews(entries);
  const pendingCount = bills.filter((b) => b.status === "pending").length;
  const failedCount = bills.filter((b) => b.status === "failed").length;
  const stuckCount = bills.filter((b) => b.stuck).length;
  snapshot = { ...snapshot, pendingCount, failedCount, stuckCount, bills };
  emit();
  await publishDeviceSyncStatus(entries);
  return snapshot;
}

export async function runPosSyncFlush(): Promise<PosSyncSnapshot> {
  if (flushing) return snapshot;
  flushing = true;
  snapshot = { ...snapshot, syncing: true };
  emit();
  try {
    const result = await flushPosOutbox();
    await refreshPosSyncSnapshot();
    snapshot = {
      ...snapshot,
      syncing: false,
      lastFlushAt: Date.now(),
      lastSynced: result.synced,
    };
    emit();
    return snapshot;
  } catch {
    snapshot = { ...snapshot, syncing: false };
    emit();
    await refreshPosSyncSnapshot();
    return snapshot;
  } finally {
    flushing = false;
  }
}

export async function retryOutboxEntry(id: string): Promise<void> {
  await resetOutboxForRetry(id);
  await refreshPosSyncSnapshot();
  await runPosSyncFlush();
}

export async function voidPendingOutboxEntry(id: string): Promise<void> {
  await removeOutboxEntry(id);
  await refreshPosSyncSnapshot();
}

export function mapCfResultToSaleResult(data: CfSaleResult, pending = false): PosSaleResult {
  return {
    saleId: data.saleId,
    billNo: data.billNo,
    change: data.change,
    total: data.total,
    pending,
  };
}
