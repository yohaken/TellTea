import { formatDateShort, formatDateShortBe } from "@/lib/utils";

export type SheetDateEra = "ce" | "be";

/**
 * Single-line Bangkok date for dense sheets — normal color.
 * Default ค.ศ. (e.g. 29/7/26). Pass era="be" for พ.ศ. (e.g. 29/7/69).
 * Opt-in per table so phased rollout does not change other sheets.
 */
export function SheetDateCell({
  ms,
  era = "ce",
}: {
  ms: number;
  era?: SheetDateEra;
}) {
  const text = era === "be" ? formatDateShortBe(ms) : formatDateShort(ms);
  return <span className="sheet-date-cell">{text}</span>;
}
