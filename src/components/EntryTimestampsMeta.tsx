"use client";

import {
  formatDateShortBe,
  formatDateShortCe,
  formatDateTimeShortBe,
  formatDateTimeShortCe,
  entryUpdatedAt,
} from "@/lib/utils";

export type EntryTimestampEra = "ce" | "be";

/** Shared «วันที่รายการ · อัปเดต» line — ledger / production / OT / owner-books. */
export function EntryTimestampsMeta({
  entryDate,
  createdAt,
  updatedAt,
  era = "be",
}: {
  entryDate: number;
  createdAt?: number;
  updatedAt?: number;
  /** Default พ.ศ.; pass era="ce" only when Gregorian display is required. */
  era?: EntryTimestampEra;
}) {
  const updated = entryUpdatedAt({ updatedAt, createdAt });
  const dateText =
    era === "ce" ? formatDateShortCe(entryDate) : formatDateShortBe(entryDate);
  const updatedText =
    era === "ce" ? formatDateTimeShortCe(updated) : formatDateTimeShortBe(updated);
  return (
    <p className="entry-detail-meta muted" aria-live="polite">
      <span>
        รายการ <strong>{dateText}</strong>
      </span>
      <span aria-hidden className="entry-detail-meta-sep">
        ·
      </span>
      <span>
        อัป <strong>{updatedText}</strong>
      </span>
    </p>
  );
}
