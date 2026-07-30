import { formatDateShort } from "@/lib/utils";

/** Single-line Bangkok date for dense sheets — e.g. 29/7/26, normal color. */
export function SheetDateCell({ ms }: { ms: number }) {
  return <span className="sheet-date-cell">{formatDateShort(ms)}</span>;
}
