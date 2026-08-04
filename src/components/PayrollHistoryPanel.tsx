"use client";

import { useMemo, useState } from "react";
import { EntryPhotoIndicator, ImagePreviewModal } from "@/components/EntryPhotoCell";
import { PayrollPaymentDocModal } from "@/components/PayrollPaymentDocModal";
import type { Employee } from "@/lib/employees";
import {
  downloadMonthEndPaymentDocsBundle,
  formatPayrollPeriodLabel,
  listMonthEndPaymentReceipts,
  openMonthEndPaymentDocsBundle,
  payeeFromEmployee,
  shopFromPosSettings,
} from "@/lib/payroll-payment-doc";
import {
  buildPayrollMonthSummaries,
  filterEmployeePayrollItems,
  findCombinedTransferTotal,
  salaryHistoryMetaBits,
  shortPayrollKindLabel,
} from "@/lib/payroll-history";
import {
  buildStaffTransferReceipts,
  type StaffTransferReceipt,
} from "@/lib/payroll-staff-receipt";
import {
  getLocalPosShopSettings,
  getPosShopSettings,
} from "@/lib/pos-settings";
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
 * แท็บหลักฐานจ่ายรายเดือน — พนักงานดูของตัวเอง · เจ้าของเลือกคน
 * รวมเงินเดือน + จ่ายแยก + โบนัส · กดดูสลิป / ใบสรุปหลักฐานจ่ายได้เมื่อจ่ายแล้ว
 */
export function PayrollHistoryPanel({
  isOwner,
  shopView,
  employeeId,
  employees,
  items,
  periodMonth,
  historySinceLabel,
  onEmployeeIdChange,
  onInfo,
  onError,
}: {
  isOwner: boolean;
  shopView: boolean;
  employeeId: string;
  employees: Employee[];
  items: PayrollItem[];
  /** เดือนที่เลือกในแถบเครื่องมือ — ใช้ปุ่มออกเอกสารท้ายเดือนทั้งร้าน */
  periodMonth?: string;
  /** เช่น "โหลดย้อนหลังจาก 2025-06" */
  historySinceLabel?: string;
  onEmployeeIdChange?: (id: string) => void;
  onInfo?: (msg: string) => void;
  onError?: (msg: string) => void;
}) {
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    urls: string[];
    title: string;
  } | null>(null);
  const [docReceipt, setDocReceipt] = useState<StaffTransferReceipt | null>(
    null,
  );
  const [bundleBusy, setBundleBusy] = useState(false);

  useBodyScrollLock(!!preview || !!docReceipt);

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

  const emp =
    roster.find((e) => e.id === employeeId) ||
    employees.find((e) => e.id === employeeId);
  const empName =
    emp?.name ||
    mine[0]?.employeeName ||
    "—";

  const paidAll = summaries.reduce((s, m) => s + m.paidTotal, 0);
  const pendingAll = summaries.reduce((s, m) => s + m.pendingTotal, 0);

  const bundleMonth = (periodMonth || "").trim();
  const monthEndReceipts = useMemo(
    () =>
      shopView && bundleMonth
        ? listMonthEndPaymentReceipts(items, bundleMonth)
        : [],
    [shopView, items, bundleMonth],
  );

  async function exportMonthEndBundle(mode: "print" | "download") {
    if (!bundleMonth || !monthEndReceipts.length) {
      onError?.("ยังไม่มีรายการท้ายเดือนที่จ่ายแล้วในงวดนี้");
      return;
    }
    setBundleBusy(true);
    try {
      let shop = shopFromPosSettings(getLocalPosShopSettings());
      try {
        shop = shopFromPosSettings(await getPosShopSettings());
      } catch {
        /* local fallback */
      }
      const payeeFor = (receipt: StaffTransferReceipt) => {
        const id = receipt.lines[0]?.item.employeeId || "";
        const name = receipt.lines[0]?.item.employeeName || "";
        return payeeFromEmployee(
          employees.find((e) => e.id === id),
          name,
        );
      };
      const ok =
        mode === "print"
          ? openMonthEndPaymentDocsBundle({
              periodMonth: bundleMonth,
              receipts: monthEndReceipts,
              shop,
              payeeFor,
            })
          : downloadMonthEndPaymentDocsBundle({
              periodMonth: bundleMonth,
              receipts: monthEndReceipts,
              shop,
              payeeFor,
            });
      if (!ok) {
        onError?.(
          mode === "print"
            ? "เปิดหน้าพิมพ์ไม่ได้ — อนุญาตป๊อปอัปแล้วลองใหม่"
            : "ดาวน์โหลดไม่สำเร็จ",
        );
        return;
      }
      onInfo?.(
        mode === "print"
          ? `เปิดชุดใบสรุปท้ายเดือน ${formatPayrollPeriodLabel(bundleMonth)} · ${monthEndReceipts.length} ใบ — เลือก「บันทึกเป็น PDF」ได้`
          : `ดาวน์โหลดชุดใบสรุปท้ายเดือน ${formatPayrollPeriodLabel(bundleMonth)} · ${monthEndReceipts.length} ใบแล้ว`,
      );
    } finally {
      setBundleBusy(false);
    }
  }

  return (
    <div className="payroll-history-panel">
      <div className="payroll-summary-bar payroll-summary-bar--solo">
        <div>
          <span className="bonus-summary-label">
            {shopView ? `หลักฐานจ่าย · ${empName}` : "หลักฐานจ่ายของฉัน"}
          </span>
          <strong>฿{fmt(paidAll)}</strong>
          <span className="muted bonus-summary-pool-meta">
            จ่ายแล้วรวม · รอโอน ฿{fmt(pendingAll)}
            {historySinceLabel ? ` · ${historySinceLabel}` : ""}
          </span>
        </div>
      </div>

      {isOwner && shopView && onEmployeeIdChange ? (
        <label className="field payroll-history-pick">
          <span>พนักงาน</span>
          <select
            value={employeeId}
            onChange={(e) => onEmployeeIdChange(e.target.value)}
            aria-label="เลือกพนักงานดูหลักฐานจ่าย"
          >
            {roster.map((empOpt) => (
              <option key={empOpt.id} value={empOpt.id}>
                {empOpt.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {isOwner && shopView && bundleMonth ? (
        <div className="payroll-history-bundle" aria-label="ออกเอกสารท้ายเดือนทั้งร้าน">
          <p className="muted payroll-actions-hint" style={{ marginBottom: "0.4rem" }}>
            ออกเอกสารย้อนหลังท้ายเดือนทั้งร้าน · งวด{" "}
            <strong>{formatPayrollPeriodLabel(bundleMonth)}</strong>
            {monthEndReceipts.length
              ? ` · พร้อม ${monthEndReceipts.length} ใบ (สิ้นเดือน/โบนัส ที่จ่ายแล้ว)`
              : " · ยังไม่มีรายการท้ายเดือนที่จ่ายแล้วในงวดนี้"}
          </p>
          <div className="payroll-latest-transfer-actions">
            <button
              type="button"
              className="primary-btn"
              disabled={bundleBusy || !monthEndReceipts.length}
              onClick={() => void exportMonthEndBundle("print")}
            >
              {bundleBusy ? "กำลังสร้าง…" : "พิมพ์ / PDF ทั้งร้าน"}
            </button>
            <button
              type="button"
              className="ghost-btn"
              disabled={bundleBusy || !monthEndReceipts.length}
              onClick={() => void exportMonthEndBundle("download")}
            >
              ดาวน์โหลดไฟล์ชุด
            </button>
          </div>
        </div>
      ) : null}

      <p className="muted payroll-actions-hint">
        แยกตามงวดงาน (ไม่ใช่วันเงินเข้าบัญชี) · แต่ละเดือน: เงินเดือน · โบนัส · รวมจ่าย ·
        แตะเดือนเพื่อดูรายการ สลิปโอน และใบสรุปหลักฐานจ่าย
      </p>

      {!employeeId ? (
        <p className="empty">ยังไม่ได้เชื่อมชื่อพนักงาน — ไปศูนย์พนักงานหรือโปรไฟล์</p>
      ) : !summaries.length ? (
        <p className="empty">ยังไม่มีหลักฐานจ่ายในช่วงที่โหลด</p>
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
                    salaryMeta={salaryHistoryMetaBits(row)}
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
                    onOpenDoc={(receipt) => setDocReceipt(receipt)}
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

      {docReceipt ? (
        <PayrollPaymentDocModal
          receipt={docReceipt}
          payee={payeeFromEmployee(emp, empName)}
          onClose={() => setDocReceipt(null)}
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
  salaryMeta,
  bonusPaid,
  bonusPending,
  paidTotal,
  pendingTotal,
  paidComplete,
  hasPending,
  items,
  onOpenSlips,
  onOpenDoc,
}: {
  open: boolean;
  onToggle: () => void;
  periodMonth: string;
  salaryPaid: number;
  salaryPending: number;
  salaryMeta: string[];
  bonusPaid: number;
  bonusPending: number;
  paidTotal: number;
  pendingTotal: number;
  paidComplete: boolean;
  hasPending: boolean;
  items: PayrollItem[];
  onOpenSlips: (item: PayrollItem) => void;
  onOpenDoc: (receipt: StaffTransferReceipt) => void;
}) {
  const statusLabel = paidComplete
    ? "ครบแล้ว"
    : hasPending
      ? "รอโอน"
      : paidTotal > 0
        ? "บางส่วน"
        : "—";

  const seenCombined = new Set<string>();
  const paidReceipts = open
    ? buildStaffTransferReceipts(items.filter((i) => i.status === "paid"))
    : [];

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
          {salaryMeta.length ? (
            <div className="muted payroll-cell-meta">{salaryMeta.join(" · ")}</div>
          ) : null}
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
      {open && paidReceipts.length ? (
        <tr className="payroll-tr is-detail payroll-history-docs-row">
          <td colSpan={5}>
            <div className="payroll-history-docs" aria-label="ใบสรุปหลักฐานการจ่าย">
              <span className="muted payroll-history-docs-label">
                ใบสรุปหลักฐานจ่าย
              </span>
              <div className="payroll-history-docs-actions">
                {paidReceipts.map((receipt) => {
                  const label = receipt.combined
                    ? `โอนรวม ฿${fmt(receipt.transferTotal)}`
                    : `${shortPayrollKindLabel(receipt.lines[0]?.kind || "salary_mid")} ฿${fmt(receipt.transferTotal)}`;
                  return (
                    <button
                      key={receipt.key}
                      type="button"
                      className="ghost-btn payroll-table-btn"
                      onClick={() => onOpenDoc(receipt)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
      {open
        ? items.map((item) => {
            const dueLabel = kindUsesMonthEndAccount(item.kind)
              ? formatDateShortBe(item.dueDate)
              : formatDateShortBe(item.dueDate);
            const hasSlips = item.slipUrls.length > 0;
            const cid = (item.combinedPayId || "").trim();
            let combinedBanner: string | null = null;
            if (cid && item.status === "paid" && !seenCombined.has(cid)) {
              seenCombined.add(cid);
              const total = findCombinedTransferTotal(items, cid);
              if (total > 0) {
                combinedBanner = `โอนครั้งเดียว ฿${fmt(total)} (สิ้นเดือน+โบนัส)`;
              }
            }
            return (
              <tr key={item.id} className={`payroll-tr status-${item.status} is-detail`}>
                <td className="payroll-col-kind" colSpan={2}>
                  {combinedBanner ? (
                    <div className="payroll-history-combined-banner">
                      {combinedBanner}
                    </div>
                  ) : null}
                  <span>{shortPayrollKindLabel(item.kind)}</span>
                  <div className="muted payroll-cell-meta">
                    โอน {dueLabel}
                    {item.advanceDeduct > 0
                      ? ` · หักเบิก ฿${fmt(item.advanceDeduct)}`
                      : ""}
                    {cid ? " · โอนรวม" : ""}
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
