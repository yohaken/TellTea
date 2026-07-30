"use client";

import {
  formatDateShort,
  formatDateShortBe,
  formatDateTimeShort,
  formatDateTimeShortBe,
  entryUpdatedAt,
} from "@/lib/utils";

export type EntryTimestampEra = "ce" | "be";

/** Shared «วันที่รายการ · อัปเดต» line — ledger / production / OT / owner-books. */
export function EntryTimestampsMeta({
  entryDate,
  createdAt,
  updatedAt,
  era = "ce",
}: {
  entryDate: number;
  createdAt?: number;
  updatedAt?: number;
  /** Opt-in พ.ศ. display — default ค.ศ. so other modules stay unchanged. */
  era?: EntryTimestampEra;
}) {
  const updated = entryUpdatedAt({ updatedAt, createdAt });
  const dateText =
    era === "be" ? formatDateShortBe(entryDate) : formatDateShort(entryDate);
  const updatedText =
    era === "be" ? formatDateTimeShortBe(updated) : formatDateTimeShort(updated);
  return (
    <p className="entry-detail-meta muted" aria-live="polite">
      <span>
        วันที่รายการ <strong>{dateText}</strong>
      </span>
      <span aria-hidden className="entry-detail-meta-sep">
        ·
      </span>
      <span>
        อัปเดต <strong>{updatedText}</strong>
      </span>
    </p>
  );
}
