import { bangkokDateParts } from "@/lib/utils";

/** Compact Bangkok date for dense sheet tables — day/month on top, year below. */
export function SheetDateCell({ ms }: { ms: number }) {
  const parts = bangkokDateParts(ms);
  if (!parts) return <span className="date-stack">—</span>;
  return (
    <span className="date-stack" title={`${parts.day}/${parts.month}/${parts.year2}`}>
      <span className="date-stack-dm">
        {parts.day}/{parts.month}
      </span>
      <span className="date-stack-yy">{parts.year2}</span>
    </span>
  );
}
