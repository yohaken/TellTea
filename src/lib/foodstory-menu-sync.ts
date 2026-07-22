import { doc, onSnapshot, type Unsubscribe } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { getDb, getFirebaseFunctions } from "./firebase";
import { mapFirestoreError } from "./firestore-errors";

export type FoodstorySyncSummary = {
  categories: { create: number; update: number; delete: number; orphanDelete: number };
  optionGroups: { create: number; update: number; delete: number; orphanDelete: number };
  items: { create: number; update: number; delete: number; orphanDelete: number };
  preservedManual?: { categories: number; optionGroups: number; items: number };
};

export type FoodstoryMenuSyncStatus = {
  hasAuth: boolean;
  branchId: string | null;
  authUpdatedAt: number | null;
  lastSync: {
    lastAppliedAt?: number;
    snapshotCapturedAt?: string;
    counts?: { categories?: number; items?: number; optionGroups?: number };
    summary?: FoodstorySyncSummary;
    actorId?: string;
  } | null;
};

export type FoodstorySyncResult = {
  ok: boolean;
  action: string;
  dryRun?: boolean;
  counts?: { categories: number; items: number; optionGroups: number; choices?: number };
  summary?: FoodstorySyncSummary;
  commits?: number;
  appliedAt?: number;
  hasAuth?: boolean;
  branchId?: string | null;
  authUpdatedAt?: number | null;
  lastSync?: FoodstoryMenuSyncStatus["lastSync"];
  updatedAt?: number;
};

type Action = "status" | "save_auth" | "sync";

async function callFoodstoryMenuSync(
  action: Action,
  extra?: Record<string, unknown>,
): Promise<FoodstorySyncResult> {
  const fn = httpsCallable<Record<string, unknown>, FoodstorySyncResult>(
    getFirebaseFunctions(),
    "foodstoryMenuSync",
  );
  try {
    const res = await fn({ action, ...(extra || {}) });
    return res.data || { ok: false, action };
  } catch (err) {
    const msg = String((err as Error)?.message || err);
    throw new Error(mapFirestoreError(err as { code?: string; message?: string }, msg));
  }
}

export function fetchFoodstoryMenuSyncStatus(): Promise<FoodstorySyncResult> {
  return callFoodstoryMenuSync("status");
}

export function saveFoodstoryAuth(input: {
  idKey: string;
  branchId: string;
  companyId?: string;
}): Promise<FoodstorySyncResult> {
  return callFoodstoryMenuSync("save_auth", input);
}

export function runFoodstoryMenuSync(opts?: {
  dryRun?: boolean;
  keepOrphans?: boolean;
  idKey?: string;
  branchId?: string;
}): Promise<FoodstorySyncResult> {
  return callFoodstoryMenuSync("sync", opts || {});
}

/** Live last-sync doc (no secrets). */
export function subscribeFoodstoryMenuSyncMeta(
  onData: (data: FoodstoryMenuSyncStatus["lastSync"]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(getDb(), "meta", "foodstoryMenuSync"),
    (snap) => {
      onData(snap.exists() ? (snap.data() as FoodstoryMenuSyncStatus["lastSync"]) : null);
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export function formatSyncWhen(ts?: number | null): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
  } catch {
    return String(ts);
  }
}
