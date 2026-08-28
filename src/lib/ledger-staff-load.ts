import { httpsCallable } from "firebase/functions";
import { getFirebaseAuth, getFirebaseFunctions } from "./firebase";
import type { LedgerEntry } from "./types";
import { LEDGER_LIVE_MAX, LEDGER_PAGE_SIZE } from "./ledger";

export type StaffLedgerBundle = {
  balance: number | null;
  totalIn: number;
  totalOut: number;
  entries: LedgerEntry[];
  hasMore: boolean;
};

type CallableLedgerRaw = {
  balance?: number | null;
  totalIn?: number;
  totalOut?: number;
  entries?: Array<{ id: string } & Record<string, unknown>>;
  hasMore?: boolean;
};

function mapLedgerRow(row: { id: string } & Record<string, unknown>): LedgerEntry {
  return {
    id: row.id,
    ...(row as unknown as Omit<LedgerEntry, "id">),
  };
}

export async function loadStaffLedgerBundleViaCallable(
  limit = LEDGER_PAGE_SIZE,
): Promise<StaffLedgerBundle> {
  const fn = httpsCallable<
    { limit: number },
    { ok?: boolean; bundle?: CallableLedgerRaw }
  >(getFirebaseFunctions(), "loadStaffLedgerBundle");
  const capped = Math.max(1, Math.min(limit, LEDGER_LIVE_MAX));
  const res = await fn({ limit: capped });
  const raw = res.data?.bundle;
  if (!res.data?.ok || !raw || !Array.isArray(raw.entries)) {
    throw new Error("โหลดบัญชีไม่สำเร็จ");
  }
  return {
    balance: raw.balance ?? null,
    totalIn: Number(raw.totalIn) || 0,
    totalOut: Number(raw.totalOut) || 0,
    entries: raw.entries.map(mapLedgerRow),
    hasMore: Boolean(raw.hasMore),
  };
}

function isPermissionDenied(err: unknown): boolean {
  const code = (err as { code?: string })?.code || "";
  const msg = (err as Error)?.message || "";
  return (
    code === "permission-denied" ||
    code === "functions/permission-denied" ||
    /insufficient permissions|Missing or insufficient permissions/i.test(msg)
  );
}

/** Staff-first loader — callable ก่อน แล้วค่อย client Firestore (owner path). */
export async function loadStaffLedgerFromServer(
  opts?: { limit?: number; staffRole?: string | null },
): Promise<{ bundle: StaffLedgerBundle } | { error: string }> {
  const limit = opts?.limit ?? LEDGER_PAGE_SIZE;
  const isOwner = opts?.staffRole === "owner";

  if (!isOwner) {
    try {
      return { bundle: await loadStaffLedgerBundleViaCallable(limit) };
    } catch (callableErr) {
      const code = (callableErr as { code?: string })?.code || "";
      const msg = (callableErr as Error)?.message || "";
      const missing =
        code === "functions/not-found" ||
        /not-found|404|UNIMPLEMENTED/i.test(msg);
      if (!missing && !isPermissionDenied(callableErr)) {
        return { error: msg || "โหลดบัญชีไม่สำเร็จ" };
      }
    }
  }

  try {
    const { listLedgerPage, getLedgerBalance } = await import("./ledger");
    const [page, balance] = await Promise.all([
      listLedgerPage(limit, null, { preferCache: false }),
      getLedgerBalance(),
    ]);
    return {
      bundle: {
        balance,
        totalIn: 0,
        totalOut: 0,
        entries: page.entries,
        hasMore: page.hasMore,
      },
    };
  } catch (err) {
    if (isPermissionDenied(err)) {
      try {
        await getFirebaseAuth().currentUser?.getIdToken(true);
        return { bundle: await loadStaffLedgerBundleViaCallable(limit) };
      } catch (retryErr) {
        const msg = (retryErr as Error)?.message || "โหลดบัญชีไม่สำเร็จ";
        return { error: msg };
      }
    }
    return { error: (err as Error)?.message || "โหลดบัญชีไม่สำเร็จ" };
  }
}
