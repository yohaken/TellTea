import { httpsCallable } from "firebase/functions";
import { getPosFirebaseAuth, getPosFirebaseFunctions } from "./pos-firebase";
import { bumpOutboxAttempt, listOutboxEntries, removeOutboxEntry } from "./pos-outbox";
import type { PosSaleMutationPayload, PosSaleResult } from "./pos-sync-types";
import { isRetryableSaleError } from "./pos-sync-utils";

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

export async function flushPosOutbox(): Promise<{ synced: number; remaining: number }> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    const remaining = (await listOutboxEntries()).length;
    return { synced: 0, remaining };
  }

  const entries = await listOutboxEntries();
  let synced = 0;

  for (const entry of entries) {
    try {
      await invokePosCompleteSale(entry.payload);
      await removeOutboxEntry(entry.id);
      synced += 1;
    } catch (err) {
      if (!isRetryableSaleError(err)) {
        await bumpOutboxAttempt(entry.id, (err as Error).message || "ถาวร");
      } else {
        await bumpOutboxAttempt(entry.id, (err as Error).message || "retry");
        break;
      }
    }
  }

  const remaining = (await listOutboxEntries()).length;
  return { synced, remaining };
}

export type PosSyncSnapshot = {
  pendingCount: number;
  lastFlushAt: number;
  lastSynced: number;
};

const listeners = new Set<(snap: PosSyncSnapshot) => void>();
let snapshot: PosSyncSnapshot = { pendingCount: 0, lastFlushAt: 0, lastSynced: 0 };
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
  const pendingCount = (await listOutboxEntries()).length;
  snapshot = { ...snapshot, pendingCount };
  emit();
  return snapshot;
}

export async function runPosSyncFlush(): Promise<PosSyncSnapshot> {
  if (flushing) return snapshot;
  flushing = true;
  try {
    const result = await flushPosOutbox();
    snapshot = {
      pendingCount: result.remaining,
      lastFlushAt: Date.now(),
      lastSynced: result.synced,
    };
    emit();
    return snapshot;
  } finally {
    flushing = false;
  }
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
