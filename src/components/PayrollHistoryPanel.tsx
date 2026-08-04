"use client";

import { useEffect, useMemo, useState } from "react";
import { EntryPhotoIndicator, ImagePreviewModal } from "@/components/EntryPhotoCell";
import type { Employee } from "@/lib/employees";
import {
  buildMonthPaymentSummary,
  formatPayrollPeriodLabel,
  legalNameForPaymentDoc,
  listMonthPaymentSummaries,
  openPaymentDocViewerShell,
  payeeFromEmployee,
  shopFromPosSettings,
  viewMonthPaymentDoc,
  viewMonthPaymentDocsBundle,
  type PayrollMonthPaymentSummary,
  type PayrollPaymentDocPayee,
} from "@/lib/payroll-payment-doc";
import {
  DEFAULT_PAYROLL_PAYMENT_DOC_SETTINGS,
  getPayrollPaymentDocSettings,
  type PayrollPaymentDocSettings,
} from "@/lib/payroll-payment-doc-settings";
import {
  buildPayrollMonthSummaries,
  filterEmployeePayrollItems,
  findCombinedTransferTotal,
  salaryHistoryMetaBits,
  shortPayrollKindLabel,
} from "@/lib/payroll-history";
import {
  getLocalPosShopSettings,
  getPosShopSettings,
} from "@/lib/pos-settings";
import {
  getStaffPersonal,
  listStaffPersonalMap,
} from "@/lib/staff-personal";
import type { StaffPersonalData } from "@/lib/types";
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
 * แท็บหลักฐานจ่าย — พนักงานเปิดดูเอกสารของตัวเองเท่านั้น (ปุ่มเดียว)
 * เจ้าของเลือกคนได้ + เปิดทั้งร้านเมื่อขยายเดือนที่ตรงงวด
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
  periodMonth?: string;
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
  const [bundleBusy, setBundleBusy] = useState(false);
  const [payerSettings, setPayerSettings] = useState<PayrollPaymentDocSettings>(
    DEFAULT_PAYROLL_PAYMENT_DOC_SETTINGS,
  );
  const [personalByStaffId, setPersonalByStaffId] = useState<
    Map<string, StaffPersonalData>
  >(new Map());

  useBodyScrollLock(!!preview);

  useEffect(() => {
    let alive = true;
    void getPayrollPaymentDocSettings()
      .then((s) => {
        if (alive) setPayerSettings(s);
      })
      .catch(() => undefined);

    async function loadPersonal() {
      if (isOwner && shopView) {
        try {
          const m = await listStaffPersonalMap();
          if (alive) setPersonalByStaffId(m);
        } catch {
          /* permission / offline */
        }
        return;
      }
      const employee = employees.find((e) => e.id === employeeId);
      const staffId = (employee?.linkedStaffId || "").trim();
      if (!staffId) return;
      try {
        const personal = await getStaffPersonal(staffId);
        if (alive && personal) {
          setPersonalByStaffId(new Map([[staffId, personal]]));
        }
      } catch {
        /* staff can only read own */
      }
    }
    void loadPersonal();
    return () => {
      alive = false;
    };
  }, [isOwner, shopView, employeeId, employees]);

  const roster = useMemo(
    () =>
      [...employees]
        .filter((e) => e.active)
        .sort((a, b) => a.name.localeCompare(b.name, "th")),
    [employees],
  );

  /** กันพลาด — ในแผงนี้ใช้เฉพาะรายการของ employeeId ที่ส่งมา */
  const mine = useMemo(
    () => filterEmployeePayrollItems(items, employeeId),
    [items, employeeId],
  );
  const summaries = useMemo(() => buildPayrollMonthSummaries(mine), [mine]);

  const emp =
    roster.find((e) => e.id === employeeId) ||
    employees.find((e) => e.id === employeeId);
  const empName = emp?.name || mine[0]?.employeeName || "—";

  const paidAll = summaries.reduce((s, m) => s + m.paidTotal, 0);
  const pendingAll = summaries.reduce((s, m) => s + m.pendingTotal, 0);

  const bundleMonth = (periodMonth || "").trim();
  const salaryByEmployeeId = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of employees) {
      const n = Number(e.monthlySalary) || 0;
      if (n > 0) map.set(e.id, n);
    }
    return map;
  }, [employees]);

  const shopMonthSummaries = useMemo(
    () =>
      isOwner && shopView && bundleMonth
        ? listMonthPaymentSummaries(items, bundleMonth, {
            monthlySalaryByEmployeeId: salaryByEmployeeId,
          })
        : [],
    [isOwner, shopView, items, bundleMonth, salaryByEmployeeId],
  );

  function payeeForEmployee(
    empId: string,
    fallbackName: string,
  ): PayrollPaymentDocPayee {
    const employee =
      employees.find((e) => e.id === empId) ||
      (empId === employeeId ? emp : undefined);
    const staffId = (employee?.linkedStaffId || "").trim();
    const personal = staffId ? personalByStaffId.get(staffId) : null;
    return payeeFromEmployee(employee, fallbackName, personal);
  }

  async function loadShop() {
    let shop = shopFromPosSettings(getLocalPosShopSettings());
    try {
      shop = shopFromPosSettings(await getPosShopSettings());
    } catch {
      /* local */
    }
    let payer = payerSettings;
    try {
      payer = await getPayrollPaymentDocSettings();
      setPayerSettings(payer);
    } catch {
      /* keep */
    }
    return { shop, payer };
  }

  async function exportOneMonth(summary: PayrollMonthPaymentSummary) {
    const viewer = openPaymentDocViewerShell();
    if (!viewer) {
      onError?.("อนุญาตป๊อปอัปเพื่อดูเอกสาร");
      return;
    }
    setBundleBusy(true);
    try {
      const { shop, payer } = await loadShop();
      const payee = payeeForEmployee(summary.employeeId, summary.employeeName);
      const ok = await viewMonthPaymentDoc({
        summary,
        shop,
        payee,
        payer,
        targetWindow: viewer,
      });
      if (!ok) {
        onError?.("เปิดเอกสารไม่สำเร็จ");
        return;
      }
      onInfo?.(
        `เปิดเอกสาร ${legalNameForPaymentDoc(payee)} · ${formatPayrollPeriodLabel(summary.periodMonth)} แล้ว — บันทึกจากตัวดูไฟล์ได้`,
      );
    } finally {
      setBundleBusy(false);
    }
  }

  async function exportShopBundle() {
    if (!isOwner || !shopView) {
      onError?.("ดูทั้งร้านได้เฉพาะเจ้าของ");
      return;
    }
    if (!bundleMonth || !shopMonthSummaries.length) {
      onError?.("ยังไม่มีรายการที่จ่ายแล้วในงวดนี้");
      return;
    }
    const viewer = openPaymentDocViewerShell();
    if (!viewer) {
      onError?.("อนุญาตป๊อปอัปเพื่อดูเอกสาร");
      return;
    }
    setBundleBusy(true);
    try {
      const { shop, payer } = await loadShop();
      const ok = await viewMonthPaymentDocsBundle({
        periodMonth: bundleMonth,
        summaries: shopMonthSummaries,
        shop,
        payer,
        payeeFor: (s) => payeeForEmployee(s.employeeId, s.employeeName),
        targetWindow: viewer,
      });
      if (!ok) {
        onError?.("เปิดเอกสารไม่สำเร็จ");
        return;
      }
      onInfo?.(
        `เปิดเอกสารทั้งร้าน ${formatPayrollPeriodLabel(bundleMonth)} · ${shopMonthSummaries.length} คนแล้ว`,
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
            {isOwner && shopView
              ? `หลักฐานจ่าย · ${empName}`
              : "หลักฐานจ่ายของฉัน"}
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

      <p className="muted payroll-actions-hint">
        แตะเดือนเพื่อขยาย → ดูเอกสาร (เงินเดือน · โบนัส · คืนเบิกถ้ามี · ยอดโอน) · บันทึก PDF จากตัวดูไฟล์ได้
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
                <th className="payroll-col-amt col-out">รวมโอน</th>
                <th className="payroll-col-status">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((row) => {
                const open = expandedMonth === row.periodMonth;
                const monthSummary = buildMonthPaymentSummary(
                  mine,
                  employeeId,
                  row.periodMonth,
                  {
                    monthlySalaryHint:
                      Number(emp?.monthlySalary) ||
                      salaryByEmployeeId.get(employeeId) ||
                      0,
                  },
                );
                return (
                  <FragmentMonth
                    key={row.periodMonth}
                    open={open}
                    onToggle={() =>
                      setExpandedMonth(open ? null : row.periodMonth)
                    }
                    periodMonth={row.periodMonth}
                    salaryPaid={row.salaryGrossPaid}
                    salaryPending={row.salaryGrossPending}
                    salaryMeta={salaryHistoryMetaBits(row)}
                    bonusPaid={row.bonusGrossPaid}
                    bonusPending={row.bonusGrossPending}
                    paidTotal={row.paidTotal}
                    pendingTotal={row.pendingTotal}
                    paidComplete={row.paidComplete}
                    hasPending={row.hasPending}
                    items={row.items}
                    monthSummary={monthSummary}
                    bundleBusy={bundleBusy}
                    showShopBundle={
                      Boolean(
                        isOwner &&
                          shopView &&
                          bundleMonth &&
                          open &&
                          row.periodMonth === bundleMonth &&
                          shopMonthSummaries.length,
                      )
                    }
                    shopBundleCount={shopMonthSummaries.length}
                    onDownload={() => {
                      if (!monthSummary) {
                        onError?.("ยังไม่มีรายการจ่ายแล้วในเดือนนี้");
                        return;
                      }
                      void exportOneMonth(monthSummary);
                    }}
                    onDownloadShop={() => void exportShopBundle()}
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
  salaryMeta,
  bonusPaid,
  bonusPending,
  paidTotal,
  pendingTotal,
  paidComplete,
  hasPending,
  items,
  monthSummary,
  bundleBusy,
  showShopBundle,
  shopBundleCount,
  onDownload,
  onDownloadShop,
  onOpenSlips,
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
  monthSummary: PayrollMonthPaymentSummary | null;
  bundleBusy: boolean;
  showShopBundle: boolean;
  shopBundleCount: number;
  onDownload: () => void;
  onDownloadShop: () => void;
  onOpenSlips: (item: PayrollItem) => void;
}) {
  const statusLabel = paidComplete
    ? "ครบแล้ว"
    : hasPending
      ? "รอโอน"
      : paidTotal > 0
        ? "บางส่วน"
        : "—";

  const seenCombined = new Set<string>();

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
      {open ? (
        <tr className="payroll-tr is-detail payroll-history-docs-row">
          <td colSpan={5}>
            <div className="payroll-history-expand-actions">
              <div className="payroll-history-expand-totals muted">
                {monthSummary ? (
                  <>
                    {monthSummary.salaryFull > 0
                      ? `เงินเดือนเต็ม ฿${fmt(monthSummary.salaryFull)} · `
                      : ""}
                    {monthSummary.midGross > 0
                      ? `กลาง ฿${fmt(monthSummary.midGross)} · `
                      : ""}
                    {monthSummary.endGross > 0
                      ? `สิ้น ฿${fmt(monthSummary.endGross)} · `
                      : ""}
                    {monthSummary.bonusGross > 0
                      ? `โบนัส ฿${fmt(monthSummary.bonusGross)} · `
                      : ""}
                    {monthSummary.advanceDeductTotal > 0
                      ? `คืนเบิก −฿${fmt(monthSummary.advanceDeductTotal)} · `
                      : ""}
                    <strong>
                      โอนเข้าบัญชี ฿{fmt(monthSummary.transferTotal)}
                    </strong>
                  </>
                ) : (
                  "ยังไม่มีรายการจ่ายแล้วในเดือนนี้"
                )}
              </div>
              <div className="payroll-history-docs-actions">
                <button
                  type="button"
                  className="primary-btn payroll-doc-dl-btn"
                  disabled={bundleBusy || !monthSummary}
                  onClick={onDownload}
                >
                  ดูเอกสาร
                </button>
                {showShopBundle ? (
                  <button
                    type="button"
                    className="ghost-btn payroll-doc-dl-btn"
                    disabled={bundleBusy}
                    onClick={onDownloadShop}
                  >
                    ทั้งร้าน ({shopBundleCount})
                  </button>
                ) : null}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
      {open
        ? items.map((item) => {
            const dueLabel = formatDateShortBe(
              kindUsesMonthEndAccount(item.kind)
                ? item.dueDate
                : item.dueDate,
            );
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
              <tr
                key={item.id}
                className={`payroll-tr status-${item.status} is-detail`}
              >
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
                      ? ` · คืนเบิก ฿${fmt(item.advanceDeduct)} (ได้ไปก่อนแล้ว)`
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
