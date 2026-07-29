/**
 * สะพานเรียลไทม์: แท็บนำเข้าผสาน → แท็บเดือน (GP ช่องทาง + ภาษีซื้อ GP)
 */
import type { VatMonthlyReturn } from "./vat-monthly";

export const VAT_IMPORT_MONTH_MERGED_EVENT = "telltea-vat-import-month-merged";

export type VatImportMonthMergedDetail = {
  monthKey: string;
  saved: VatMonthlyReturn;
  at: number;
};

function stampKey(monthKey: string) {
  return `telltea:vat-import-merged:${monthKey}`;
}

/** เรียกหลัง saveVatMonthlyReturn จาก import merge */
export function notifyVatImportMonthMerged(
  monthKey: string,
  saved: VatMonthlyReturn,
): void {
  if (typeof window === "undefined") return;
  const at = Date.now();
  try {
    sessionStorage.setItem(stampKey(monthKey), String(at));
  } catch {
    /* private mode */
  }
  window.dispatchEvent(
    new CustomEvent<VatImportMonthMergedDetail>(VAT_IMPORT_MONTH_MERGED_EVENT, {
      detail: { monthKey, saved, at },
    }),
  );
}

/** มีการผสานจากนำเข้าในหน้าต่างนี้เร็วๆ นี้ไหม */
export function recentVatImportMergeAt(monthKey: string): number {
  if (typeof window === "undefined") return 0;
  try {
    return Number(sessionStorage.getItem(stampKey(monthKey)) || 0) || 0;
  } catch {
    return 0;
  }
}

export function subscribeVatImportMonthMerged(
  listener: (detail: VatImportMonthMergedDetail) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = (ev: Event) => {
    const detail = (ev as CustomEvent<VatImportMonthMergedDetail>).detail;
    if (!detail?.monthKey || !detail.saved) return;
    listener(detail);
  };
  window.addEventListener(VAT_IMPORT_MONTH_MERGED_EVENT, handler);
  return () => window.removeEventListener(VAT_IMPORT_MONTH_MERGED_EVENT, handler);
}
