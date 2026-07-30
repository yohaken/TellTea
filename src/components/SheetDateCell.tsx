import { formatDateShortBe, formatDateShortCe } from "@/lib/utils";

export type SheetDateEra = "ce" | "be";

/**
 * Single-line Bangkok date for dense sheets — normal color.
 * Default พ.ศ. (e.g. 29/7/69). Pass era="ce" only when Gregorian is required.
 */
export function SheetDateCell({
  ms,
  era = "be",
}: {
  ms: number;
  era?: SheetDateEra;
}) {
  const text = era === "ce" ? formatDateShortCe(ms) : formatDateShortBe(ms);
  return <span className="sheet-date-cell">{text}</span>;
}
