import type { ProdEntry } from "./production";
import { monthInputValue, parseMonthInput } from "./bonus";

export type ProdEntryQtyPick = Pick<
  ProdEntry,
  "workerIds" | "workerNames" | "productId" | "productName" | "qtyProduced"
>;

/** Shift YYYY-MM by ±N calendar months. */
export function shiftMonthInput(ym: string, deltaMonths: number): string {
  const { year, month } = parseMonthInput(ym);
  if (!year || Number.isNaN(month)) return String(ym || "").trim();
  return monthInputValue(new Date(year, month + deltaMonths, 1));
}

export type ProdProductCompareRow = {
  productId: string;
  productName: string;
  qtyPrev: number;
  qtyNow: number;
  /** qtyNow − qtyPrev (pieces) */
  diff: number;
};

export type ProdProductCompareSummary = {
  rows: ProdProductCompareRow[];
  totalPrev: number;
  totalNow: number;
  totalDiff: number;
};

export type ProdWorkerCompareRow = {
  workerId: string;
  workerName: string;
  productId: string;
  productName: string;
  qtyPrev: number;
  qtyNow: number;
  diff: number;
};

export type ProdWorkerCompareSummary = {
  rows: ProdWorkerCompareRow[];
  totalPrev: number;
  totalNow: number;
  totalDiff: number;
};

function pieceQty(raw: unknown): number {
  return Math.max(0, Math.round(Number(raw) || 0));
}

/** Sum qtyProduced by product (no worker split — shop overview). */
function qtyByProduct(entries: ProdEntryQtyPick[]): Map<string, { productName: string; qty: number }> {
  const map = new Map<string, { productName: string; qty: number }>();
  for (const row of entries) {
    const qty = pieceQty(row.qtyProduced);
    if (qty <= 0) continue;
    const productId = String(row.productId || "").trim() || "_";
    const productName = String(row.productName || "").trim() || "—";
    const prev = map.get(productId);
    if (prev) {
      prev.qty += qty;
      if (productName !== "—") prev.productName = productName;
    } else {
      map.set(productId, { productName, qty });
    }
  }
  return map;
}

/**
 * Full piece credit per worker on a shared bake (integer pieces, not money).
 * Key = workerId:productId
 */
function qtyByWorkerProduct(
  entries: ProdEntryQtyPick[],
): Map<string, { workerId: string; workerName: string; productId: string; productName: string; qty: number }> {
  const map = new Map<
    string,
    { workerId: string; workerName: string; productId: string; productName: string; qty: number }
  >();
  for (const row of entries) {
    const qty = pieceQty(row.qtyProduced);
    if (qty <= 0) continue;
    const ids = (row.workerIds || []).map((id) => String(id || "").trim()).filter(Boolean);
    const names = row.workerNames || [];
    const productId = String(row.productId || "").trim() || "_";
    const productName = String(row.productName || "").trim() || "—";
    const people = ids.length
      ? ids.map((id, i) => ({
          workerId: id,
          workerName: String(names[i] || "").trim() || id,
        }))
      : [{ workerId: "_", workerName: "—" }];

    for (const person of people) {
      const key = `${person.workerId}:${productId}`;
      const prev = map.get(key);
      if (prev) {
        prev.qty += qty;
        if (person.workerName && person.workerName !== person.workerId) {
          prev.workerName = person.workerName;
        }
        if (productName !== "—") prev.productName = productName;
      } else {
        map.set(key, {
          workerId: person.workerId,
          workerName: person.workerName,
          productId,
          productName,
          qty,
        });
      }
    }
  }
  return map;
}

/**
 * Product overview — no producer names.
 * Columns: product · last month · this month · ±diff
 */
export function buildProdProductCompareSummary(
  nowEntries: ProdEntryQtyPick[],
  prevEntries: ProdEntryQtyPick[],
): ProdProductCompareSummary {
  const nowMap = qtyByProduct(nowEntries);
  const prevMap = qtyByProduct(prevEntries);
  const ids = new Set([...nowMap.keys(), ...prevMap.keys()]);
  const rows: ProdProductCompareRow[] = [];
  let totalPrev = 0;
  let totalNow = 0;

  for (const productId of ids) {
    const now = nowMap.get(productId);
    const prev = prevMap.get(productId);
    const qtyPrev = prev?.qty || 0;
    const qtyNow = now?.qty || 0;
    if (qtyPrev <= 0 && qtyNow <= 0) continue;
    totalPrev += qtyPrev;
    totalNow += qtyNow;
    rows.push({
      productId,
      productName: now?.productName || prev?.productName || "—",
      qtyPrev,
      qtyNow,
      diff: qtyNow - qtyPrev,
    });
  }

  rows.sort((a, b) => {
    if (b.qtyNow !== a.qtyNow) return b.qtyNow - a.qtyNow;
    return a.productName.localeCompare(b.productName, "th");
  });

  return {
    rows,
    totalPrev,
    totalNow,
    totalDiff: totalNow - totalPrev,
  };
}

/**
 * Per worker × product — what each person produced vs last month.
 */
export function buildProdWorkerCompareSummary(
  nowEntries: ProdEntryQtyPick[],
  prevEntries: ProdEntryQtyPick[],
): ProdWorkerCompareSummary {
  const nowMap = qtyByWorkerProduct(nowEntries);
  const prevMap = qtyByWorkerProduct(prevEntries);
  const keys = new Set([...nowMap.keys(), ...prevMap.keys()]);
  const rows: ProdWorkerCompareRow[] = [];
  let totalPrev = 0;
  let totalNow = 0;

  for (const key of keys) {
    const now = nowMap.get(key);
    const prev = prevMap.get(key);
    const qtyPrev = prev?.qty || 0;
    const qtyNow = now?.qty || 0;
    if (qtyPrev <= 0 && qtyNow <= 0) continue;
    // Totals for worker table: sum of person credits (shared bake counted per person)
    totalPrev += qtyPrev;
    totalNow += qtyNow;
    rows.push({
      workerId: now?.workerId || prev?.workerId || "_",
      workerName: now?.workerName || prev?.workerName || "—",
      productId: now?.productId || prev?.productId || "_",
      productName: now?.productName || prev?.productName || "—",
      qtyPrev,
      qtyNow,
      diff: qtyNow - qtyPrev,
    });
  }

  rows.sort((a, b) => {
    if (b.qtyNow !== a.qtyNow) return b.qtyNow - a.qtyNow;
    const byName = a.workerName.localeCompare(b.workerName, "th");
    if (byName) return byName;
    return a.productName.localeCompare(b.productName, "th");
  });

  return {
    rows,
    totalPrev,
    totalNow,
    totalDiff: totalNow - totalPrev,
  };
}

/** @deprecated use buildProdWorkerCompareSummary — kept for older imports */
export function buildProdWorkSummary(entries: ProdEntryQtyPick[]) {
  const cmp = buildProdWorkerCompareSummary(entries, []);
  return {
    rows: cmp.rows.map((r) => ({
      workerId: r.workerId,
      workerName: r.workerName,
      productId: r.productId,
      productName: r.productName,
      qty: r.qtyNow,
    })),
    totalQty: cmp.totalNow,
  };
}
