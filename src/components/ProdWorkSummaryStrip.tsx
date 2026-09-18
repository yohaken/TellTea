"use client";

import { useMemo, useState } from "react";
import type {
  ProdProductCompareSummary,
  ProdWorkerCompareRow,
  ProdWorkerCompareSummary,
} from "@/lib/prod-work-summary";
import { cn, formatStockQty } from "@/lib/utils";

function formatDiff(n: number) {
  if (!Number.isFinite(n) || n === 0) return "0";
  const body = formatStockQty(Math.abs(n));
  if (n > 0) return `+${body}`;
  return `−${body}`;
}

function diffClass(n: number) {
  if (n > 0) return "is-up";
  if (n < 0) return "is-down";
  return "is-flat";
}

/**
 * Product-only overview (no producer names):
 * สินค้า · จำนวน(เดือนก่อน) · จำนวน · ส่วนต่าง
 */
export function ProdProductSummaryStrip({
  month,
  prevMonth,
  summary,
  className,
}: {
  month: string;
  prevMonth: string;
  summary: ProdProductCompareSummary;
  className?: string;
}) {
  if (!summary.rows.length) return null;

  return (
    <section
      className={cn("prod-work-summary-strip", className)}
      aria-label="สรุปจำนวนผลิตตามสินค้า"
    >
      <p className="prod-work-summary-head">
        <span className="prod-work-summary-title">ผลิต · สินค้า</span>
        <span className="muted prod-work-summary-note">
          {prevMonth} → {month}
        </span>
      </p>
      <table className="prod-work-summary-table is-compare">
        <thead>
          <tr>
            <th scope="col">สินค้า</th>
            <th scope="col" className="prod-work-summary-num">
              เดือนก่อน
            </th>
            <th scope="col" className="prod-work-summary-num">
              จำนวน
            </th>
            <th scope="col" className="prod-work-summary-num">
              ส่วนต่าง
            </th>
          </tr>
        </thead>
        <tbody>
          {summary.rows.map((row) => (
            <tr key={row.productId}>
              <th scope="row" title={row.productName}>
                {row.productName}
              </th>
              <td className="prod-work-summary-num">{formatStockQty(row.qtyPrev)}</td>
              <td className="prod-work-summary-num">{formatStockQty(row.qtyNow)}</td>
              <td
                className={cn(
                  "prod-work-summary-num",
                  "prod-work-summary-diff",
                  diffClass(row.diff),
                )}
              >
                {formatDiff(row.diff)}
              </td>
            </tr>
          ))}
          <tr className="is-total">
            <th scope="row">รวมชิ้น</th>
            <td className="prod-work-summary-num">
              {formatStockQty(summary.totalPrev)}
            </td>
            <td className="prod-work-summary-num">
              {formatStockQty(summary.totalNow)}
            </td>
            <td
              className={cn(
                "prod-work-summary-num",
                "prod-work-summary-diff",
                diffClass(summary.totalDiff),
              )}
            >
              {formatDiff(summary.totalDiff)}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

type WorkerSortKey = "name" | "product" | "qtyPrev" | "qtyNow" | "diff";

function sortWorkerRows(
  rows: ProdWorkerCompareRow[],
  key: WorkerSortKey,
  dir: "asc" | "desc",
): ProdWorkerCompareRow[] {
  const mul = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    let cmp = 0;
    if (key === "name") cmp = a.workerName.localeCompare(b.workerName, "th");
    else if (key === "product") cmp = a.productName.localeCompare(b.productName, "th");
    else if (key === "qtyPrev") cmp = a.qtyPrev - b.qtyPrev;
    else if (key === "qtyNow") cmp = a.qtyNow - b.qtyNow;
    else cmp = a.diff - b.diff;
    if (cmp) return cmp * mul;
    // Stable tie-breakers
    const byName = a.workerName.localeCompare(b.workerName, "th");
    if (byName) return byName;
    return a.productName.localeCompare(b.productName, "th");
  });
}

function SortTh({
  label,
  colKey,
  activeKey,
  dir,
  numeric,
  onSort,
}: {
  label: string;
  colKey: WorkerSortKey;
  activeKey: WorkerSortKey;
  dir: "asc" | "desc";
  numeric?: boolean;
  onSort: (key: WorkerSortKey) => void;
}) {
  const active = activeKey === colKey;
  const mark = active ? (dir === "asc" ? " ↑" : " ↓") : "";
  return (
    <th
      scope="col"
      className={cn(numeric && "prod-work-summary-num", "prod-work-summary-sort-th")}
    >
      <button
        type="button"
        className={cn("prod-work-summary-sort-btn", active && "is-active")}
        onClick={() => onSort(colKey)}
        aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
        title={`เรียงตาม${label}`}
      >
        {label}
        {mark}
      </button>
    </th>
  );
}

/**
 * Per staff: ชื่อ · สินค้า · เดือนก่อน · จำนวน · ส่วนต่าง
 * Tap column headers to sort.
 */
export function ProdWorkerSummaryStrip({
  month,
  prevMonth,
  summary,
  highlightWorkerId,
  className,
}: {
  month: string;
  prevMonth: string;
  summary: ProdWorkerCompareSummary;
  highlightWorkerId?: string | null;
  className?: string;
}) {
  const [sortKey, setSortKey] = useState<WorkerSortKey>("qtyNow");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const rows = useMemo(
    () => sortWorkerRows(summary.rows, sortKey, sortDir),
    [summary.rows, sortKey, sortDir],
  );

  if (!summary.rows.length) return null;
  const me = String(highlightWorkerId || "").trim();

  function onSort(key: WorkerSortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    // Numbers default high→low; names A→Z
    setSortDir(key === "name" || key === "product" ? "asc" : "desc");
  }

  return (
    <section
      className={cn("prod-work-summary-strip", "is-worker", className)}
      aria-label="สรุปจำนวนผลิตตามพนักงาน"
    >
      <p className="prod-work-summary-head">
        <span className="prod-work-summary-title">ผลิต · ตามคน</span>
        <span className="muted prod-work-summary-note">
          {prevMonth} → {month} · แตะหัวคอลัมน์เพื่อเรียง
        </span>
      </p>
      <table className="prod-work-summary-table is-compare is-worker">
        <thead>
          <tr>
            <SortTh
              label="ชื่อ"
              colKey="name"
              activeKey={sortKey}
              dir={sortDir}
              onSort={onSort}
            />
            <SortTh
              label="สินค้า"
              colKey="product"
              activeKey={sortKey}
              dir={sortDir}
              onSort={onSort}
            />
            <SortTh
              label="เดือนก่อน"
              colKey="qtyPrev"
              activeKey={sortKey}
              dir={sortDir}
              numeric
              onSort={onSort}
            />
            <SortTh
              label="จำนวน"
              colKey="qtyNow"
              activeKey={sortKey}
              dir={sortDir}
              numeric
              onSort={onSort}
            />
            <SortTh
              label="ส่วนต่าง"
              colKey="diff"
              activeKey={sortKey}
              dir={sortDir}
              numeric
              onSort={onSort}
            />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isMe = Boolean(me && row.workerId === me);
            return (
              <tr
                key={`${row.workerId}:${row.productId}`}
                className={cn(isMe && "is-me")}
              >
                <th scope="row" title={row.workerName}>
                  {row.workerName}
                  {isMe ? <span className="prod-work-summary-me">·</span> : null}
                </th>
                <td className="prod-work-summary-prod" title={row.productName}>
                  {row.productName}
                </td>
                <td className="prod-work-summary-num">
                  {formatStockQty(row.qtyPrev)}
                </td>
                <td className="prod-work-summary-num">
                  {formatStockQty(row.qtyNow)}
                </td>
                <td
                  className={cn(
                    "prod-work-summary-num",
                    "prod-work-summary-diff",
                    diffClass(row.diff),
                  )}
                >
                  {formatDiff(row.diff)}
                </td>
              </tr>
            );
          })}
          <tr className="is-total">
            <th scope="row" colSpan={2}>
              รวมชิ้น
            </th>
            <td className="prod-work-summary-num">
              {formatStockQty(summary.totalPrev)}
            </td>
            <td className="prod-work-summary-num">
              {formatStockQty(summary.totalNow)}
            </td>
            <td
              className={cn(
                "prod-work-summary-num",
                "prod-work-summary-diff",
                diffClass(summary.totalDiff),
              )}
            >
              {formatDiff(summary.totalDiff)}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

/** @deprecated */
export function ProdWorkSummaryStrip(
  props: Parameters<typeof ProdWorkerSummaryStrip>[0] & {
    summary: ProdWorkerCompareSummary;
  },
) {
  return <ProdWorkerSummaryStrip {...props} />;
}
