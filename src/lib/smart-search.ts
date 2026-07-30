import { labelLedgerType } from "./ledger-labels";
import {
  bangkokDateKey,
  formatDateShort,
  formatPlainNumber,
  toEpochMs,
} from "./utils";

function normalizeText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Split into tokens; empty query → no tokens (match all). */
export function searchTokens(query: string): string[] {
  const q = normalizeText(query);
  if (!q) return [];
  return q.split(/[\s,;/|]+/).filter(Boolean);
}

function haystackMatch(haystack: string, tokens: string[]) {
  const h = normalizeText(haystack);
  return tokens.every((t) => h.includes(t));
}

type DatedRow = {
  date: number;
  createdAt?: number;
};

/**
 * UI list order — Asia/Bangkok calendar day newest→oldest, then createdAt.
 * Uses Bangkok day keys so mixed UTC/Bangkok midnights still match the date column.
 */
export function sortByDateNewestFirst<T extends DatedRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const aKey = bangkokDateKey(toEpochMs(a.date));
    const bKey = bangkokDateKey(toEpochMs(b.date));
    if (aKey !== bKey) return bKey.localeCompare(aKey);
    return toEpochMs(b.createdAt) - toEpochMs(a.createdAt);
  });
}

type SearchableOwnerRow = {
  date: number;
  description: string;
  amountOut: number;
  type?: string;
  note?: string;
};

/** Smart filter: all tokens must match somewhere across row fields. */
export function filterOwnerBookRows<T extends SearchableOwnerRow>(
  rows: T[],
  query: string,
): T[] {
  const tokens = searchTokens(query);
  if (!tokens.length) return rows;

  return rows.filter((row) => {
    const typeLabel = row.type ? labelLedgerType(row.type) : "";
    const blob = [
      row.description || "",
      row.type || "",
      typeLabel,
      row.note || "",
      formatDateShort(row.date),
      formatPlainNumber(row.amountOut || 0),
      String(row.amountOut || ""),
      String(row.amountOut || "").replace(/,/g, ""),
    ].join(" ");
    return haystackMatch(blob, tokens);
  });
}

type SearchableLedgerRow = {
  date: number;
  description: string;
  amountIn: number;
  amountOut: number;
  type?: string;
};

export function filterLedgerRows<T extends SearchableLedgerRow>(
  rows: T[],
  query: string,
): T[] {
  const tokens = searchTokens(query);
  if (!tokens.length) return rows;

  return rows.filter((row) => {
    const typeLabel = row.type ? labelLedgerType(row.type) : "";
    const blob = [
      row.description || "",
      row.type || "",
      typeLabel,
      formatDateShort(row.date),
      formatPlainNumber(row.amountIn || 0),
      formatPlainNumber(row.amountOut || 0),
      String(row.amountIn || ""),
      String(row.amountOut || ""),
    ].join(" ");
    return haystackMatch(blob, tokens);
  });
}
