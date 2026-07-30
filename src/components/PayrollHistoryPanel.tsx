"use client";

import { useMemo, useState } from "react";
import { EntryPhotoIndicator, ImagePreviewModal } from "@/components/EntryPhotoCell";
import type { Employee } from "@/lib/employees";
import {
  buildPayrollMonthSummaries,
  filterEmployeePayrollItems,
  shortPayrollKindLabel,
} from "@/lib/payroll-history";
import {
  PAYROLL_STATUS_LABELS,
  kindUsesMonthEndAccount,
  type PayrollItem,
} from "@/lib/payroll";
import { formatDateShortBe, formatPlainNumber } from "@/lib/utils";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

function fmt(n: number) {
  return formatPlainNumber(n);
}

/**
 * ตารางประวัติจ่ายรายเดือน — พนักงานดูของตัวเอง · เจ้าของเลือกคน
 * รวมเงินเดือน + จ่ายแยก + โบนัส · กดดูสลิปได้เมื่อมี
 */
export function PayrollHistoryPanel({
  isOwner,
  shopView,
  employeeId,
  employees,
  items,
  onEmployeeIdChange,
}: {
  isOwner: boolean;
  shopView: boolean;
  employeeId: string;
  employees: Employee[];
  items: PayrollItem[];
  onEmployeeIdChange?: (id: string) => void;
}) {
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    urls: string[];
    title: string;
  } | null>(null);

  useBodyScrollLock(!!preview);

  const roster = useMemo(
    () =>
      [...employees]
        .filter((e) => e.active)
        .sort((a, b) => a.name.localeCompare(b.name, "th")),
    [employees],
  );

  const mine = useMemo(
    () => filterEmployeePayrollItems(items, employeeId),
    [items, employeeId],
  );
  const summaries = useMemo(() => buildPayrollMonthSummaries(mine), [mine]);

  const empName =
    roster.find((e) => e.id === employeeId)?.name ||
    mine[0]?.employeeName ||
    "—";

  const paidAll = summaries.reduce((s, m) => s + m.paidTotal, 0);
  const pendingAll = summaries.reduce((s, m) => s + m.pendingTotal, 0);

  return (
    <div className="payroll-history-panel">
      <div className="payroll-summary-bar payroll-summary-bar--solo">
        <div>
          <span className="bonus-summary-label">
            {shopView ? `ประวัติ · ${empName}` : "ประวัติของฉัน"}
          </span>
          <strong>฿{fmt(paidAll)}</strong>
          <span className="muted bonus-summary-pool-meta">
            จ่ายแล้วรวม · รอโอน ฿{fmt(pendingAll)}
          </span>
        </div>
      </div>

      {isOwner && shopView && onEmployeeIdChange ? (
        <label className="field payroll-history-pick">
          <span>พนักงาน</span>
          <select
            value={employeeId}
            onChange={(e) => onEmployeeIdChange(e.target.value)}
            aria-label="เลือกพนักงานดูประวัติ"
          >
            {roster.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <p className="muted payroll-actions-hint">
        แต่ละเดือน: เงินเดือน · จ่ายแยก · โบนัส · สถานะครบ/รอ · แตะเดือนเพื่อดูรายการและสลิปโอน
      </p>

      {!employeeId ? (
        <p className="empty">ยังไม่ได้เชื่อมชื่อพนักงาน — ไปศูนย์พนักงานหรือโปรไฟล์</p>
      ) : !summaries.length ? (
        <p className="empty">ยังไม่มีประวัติจ่ายในช่วงที่โหลด</p>
      ) : (
        <div className="sheet-scroll payroll-sheet sheet-bleed">
          <table className="sheet-table payroll-table sheet-table--dense payroll-history-table">
            <thead>
              <tr>
                <th className="payroll-col-kind">เดือน</th>
                <th className="payroll-col-amt col-out">เงินเดือน</th>
                <th className="payroll-col-amt col-out">โบนัส</th>
                <th className="payroll-col-amt col-out">รวมจ่าย</th>
                <th className="payroll-col-status">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((row) => {
                const salaryPaid =
                  row.salaryMidPaid + row.salaryEndPaid + row.specialPaid;
                const salaryPending =
                  row.salaryMidPending +
                  row.salaryEndPending +
                  row.specialPending;
                const open = expandedMonth === row.periodMonth;
                return (
                  <FragmentMonth
                    key={row.periodMonth}
                    open={open}
                    onToggle={() =>
                      setExpandedMonth(open ? null : row.periodMonth)
                    }
                    periodMonth={row.periodMonth}
                    salaryPaid={salaryPaid}
                    salaryPending={salaryPending}
                    bonusPaid={row.bonusPaid}
                    bonusPending={row.bonusPending}
                    paidTotal={row.paidTotal}
                    pendingTotal={row.pendingTotal}
                    paidComplete={row.paidComplete}
                    hasPending={row.hasPending}
                    items={row.items}
                    onOpenSlips={(item) =>
                      setPreview({
                        urls: item.slipUrls,
                        title: `${shortPayrollKindLabel(item.kind)} · ${item.periodMonth}`,
                      })
                    }
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {preview ? (
        <ImagePreviewModal
          urls={preview.urls}
          title={preview.title}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </div>
  );
}

function FragmentMonth({
  open,
  onToggle,
  periodMonth,
  salaryPaid,
  salaryPending,
  bonusPaid,
  bonusPending,
  paidTotal,
  pendingTotal,
  paidComplete,
  hasPending,
  items,
  onOpenSlips,
}: {
  open: boolean;
  onToggle: () => void;
  periodMonth: string;
  salaryPaid: number;
  salaryPending: number;
  bonusPaid: number;
  bonusPending: number;
  paidTotal: number;
  pendingTotal: number;
  paidComplete: boolean;
  hasPending: boolean;
  items: PayrollItem[];
  onOpenSlips: (item: PayrollItem) => void;
}) {
  const statusLabel = paidComplete
    ? "ครบแล้ว"
    : hasPending
      ? "รอโอน"
      : paidTotal > 0
        ? "บางส่วน"
        : "—";

  return (
    <>
      <tr
        className={`payroll-tr payroll-history-month${open ? " is-expanded" : ""}`}
      >
        <td className="payroll-col-kind">
          <button
            type="button"
            className="desc-link"
            onClick={onToggle}
            aria-expanded={open}
          >
            {periodMonth}
          </button>
        </td>
        <td className="payroll-col-amt col-out">
          ฿{fmt(salaryPaid)}
          {salaryPending > 0 ? (
            <div className="muted payroll-cell-meta">รอ ฿{fmt(salaryPending)}</div>
          ) : null}
        </td>
        <td className="payroll-col-amt col-out">
          ฿{fmt(bonusPaid)}
          {bonusPending > 0 ? (
            <div className="muted payroll-cell-meta">รอ ฿{fmt(bonusPending)}</div>
          ) : null}
        </td>
        <td className="payroll-col-amt col-out">
          <strong>฿{fmt(paidTotal)}</strong>
          {pendingTotal > 0 ? (
            <div className="muted payroll-cell-meta">รอ ฿{fmt(pendingTotal)}</div>
          ) : null}
        </td>
        <td className="payroll-col-status">
          <span
            className={`payroll-status ${
              paidComplete
                ? "status-paid"
                : hasPending
                  ? "status-pending"
                  : "status-void"
            }`}
          >
            {statusLabel}
          </span>
        </td>
      </tr>
      {open
        ? items.map((item) => {
            const dueLabel = kindUsesMonthEndAccount(item.kind)
              ? formatDateShortBe(item.dueDate)
              : formatDateShortBe(item.dueDate);
            const hasSlips = item.slipUrls.length > 0;
            return (
              <tr key={item.id} className={`payroll-tr status-${item.status} is-detail`}>
                <td className="payroll-col-kind" colSpan={2}>
                  <span>{shortPayrollKindLabel(item.kind)}</span>
                  <div className="muted payroll-cell-meta">
                    โอน {dueLabel}
                    {item.advanceDeduct > 0
                      ? ` · หักเบิก ฿${fmt(item.advanceDeduct)}`
                      : ""}
                    {item.note ? ` · ${item.note}` : ""}
                  </div>
                </td>
                <td className="payroll-col-status">
                  {PAYROLL_STATUS_LABELS[item.status]}
                </td>
                <td className="payroll-col-amt col-out">฿{fmt(item.amount)}</td>
                <td className="payroll-col-status">
                  {hasSlips ? (
                    <EntryPhotoIndicator
                      imageUrls={item.slipUrls}
                      onView={() => onOpenSlips(item)}
                      label="สลิป"
                    />
                  ) : item.status === "paid" ? (
                    <span className="muted">ไม่มีสลิป</span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            );
          })
        : null}
    </>
  );
}
