"use client";

import { formatDateShort, formatDateTimeShort, entryUpdatedAt } from "@/lib/utils";

/** Shared «วันที่รายการ · อัปเดต» line — ledger / production / OT / owner-books. */
export function EntryTimestampsMeta({
  entryDate,
  createdAt,
  updatedAt,
}: {
  entryDate: number;
  createdAt?: number;
  updatedAt?: number;
}) {
  const updated = entryUpdatedAt({ updatedAt, createdAt });
  return (
    <p className="entry-detail-meta muted" aria-live="polite">
      <span>
        วันที่รายการ <strong>{formatDateShort(entryDate)}</strong>
      </span>
      <span aria-hidden className="entry-detail-meta-sep">
        ·
      </span>
      <span>
        อัปเดต <strong>{formatDateTimeShort(updated)}</strong>
      </span>
    </p>
  );
}
