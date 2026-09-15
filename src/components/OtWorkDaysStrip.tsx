"use client";

import type { OtWorkDayRow } from "@/lib/ot-work-days";
import { cn } from "@/lib/utils";

/**
 * Superslim OT attendance — days worked only (no month denominator).
 */
export function OtWorkDaysStrip({
  month,
  rows,
  highlightWorkerId,
  className,
  compact = false,
}: {
  month: string;
  rows: OtWorkDayRow[];
  highlightWorkerId?: string | null;
  className?: string;
  compact?: boolean;
}) {
  if (!rows.length) return null;
  const daysInMonth = rows[0]?.daysInMonth || 0;
  const me = String(highlightWorkerId || "").trim();

  return (
    <section
      className={cn("ot-work-days-strip", compact && "is-compact", className)}
      aria-label="วันเข้างานจากชง"
    >
      <p className="ot-work-days-head">
        <span className="ot-work-days-title">เข้างาน</span>
        <span className="muted ot-work-days-note">{month}</span>
      </p>
      <table className="ot-work-days-table">
        <tbody>
          {rows.map((row) => {
            const isMe = Boolean(me && row.workerId === me);
            const low = daysInMonth > 0 && row.daysWorked / daysInMonth < 0.45;
            return (
              <tr
                key={row.workerId}
                className={cn(isMe && "is-me", low && "is-low")}
              >
                <th scope="row" title={row.workerName}>
                  {row.workerName}
                  {isMe ? <span className="ot-work-days-me">·</span> : null}
                </th>
                <td className="ot-work-days-num">{row.daysWorked}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** One-line personal summary for bonus “ของฉัน” card */
export function OtWorkDaysPersonalLine({
  row,
}: {
  row: OtWorkDayRow | null;
}) {
  if (!row) return null;
  return (
    <p className="ot-work-days-personal muted">
      เข้างาน <strong>{row.daysWorked}</strong> วัน
    </p>
  );
}
