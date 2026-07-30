"use client";

import { useMemo, useState } from "react";
import { PhotoAttachMultiField } from "@/components/PhotoAttachMultiField";
import type { Employee } from "@/lib/employees";
import type { OtEntry } from "@/lib/ot";
import {
  generatePayrollForPeriod,
  kindUsesMonthEndAccount,
  markPayrollPaid,
  PAYROLL_KIND_LABELS,
  PAYROLL_SLIP_MAX,
  PAYROLL_STATUS_LABELS,
  payrollDescription,
  restorePayrollItem,
  summarizePayrollItems,
  voidPayrollItem,
  type BonusAmountByEmployee,
  type PayrollGenerateScope,
  type PayrollItem,
  type PayrollKind,
  type PayrollSchedule,
} from "@/lib/payroll";
import type { ProdEntry } from "@/lib/production";
import { formatDateShort, formatPlainNumber } from "@/lib/utils";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

function fmt(n: number) {
  return formatPlainNumber(n);
}

type PayTarget = {
  item: PayrollItem;
  slipUrls: string[];
  note: string;
};

function shortKind(kind: PayrollKind): string {
  if (kind === "salary_mid") return "กลางเดือน";
  if (kind === "salary_month_end") return "สิ้นเดือน";
  return "โบนัส";
}

export function PayrollPayPanel({
  isOwner,
  shopView,
  actorId,
  periodMonth,
  employees,
  schedule,
  items,
  bonusByEmployee,
  prodEntries,
  otEntries,
  canPay,
  onError,
  onInfo,
}: {
  isOwner: boolean;
  /** true = เห็นคิวทั้งร้าน (เจ้าของ / คนโอน) · false = เฉพาะของตัวเอง */
  shopView: boolean;
  actorId: string;
  periodMonth: string;
  employees: Employee[];
  schedule: PayrollSchedule;
  items: PayrollItem[];
  bonusByEmployee: BonusAmountByEmployee;
  prodEntries: ProdEntry[];
  otEntries: OtEntry[];
  canPay: boolean;
  onError: (msg: string) => void;
  onInfo?: (msg: string) => void;
}) {
  const [filter, setFilter] = useState<"pending" | "all" | "void" | PayrollKind>("pending");
  const [busy, setBusy] = useState(false);
  const [payTarget, setPayTarget] = useState<PayTarget | null>(null);

  useBodyScrollLock(!!payTarget);

  const periodItems = useMemo(
    () => items.filter((i) => i.periodMonth === periodMonth),
    [items, periodMonth],
  );

  const visible = useMemo(() => {
    let rows = periodItems;
    if (filter === "pending") rows = rows.filter((i) => i.status === "pending");
    else if (filter === "void") rows = rows.filter((i) => i.status === "void");
    else if (filter !== "all") rows = rows.filter((i) => i.kind === filter);
    return [...rows].sort((a, b) => {
      if (a.status === "pending" && b.status !== "pending") return -1;
      if (a.status !== "pending" && b.status === "pending") return 1;
      return a.dueDate - b.dueDate || a.employeeName.localeCompare(b.employeeName, "th");
    });
  }, [periodItems, filter]);

  const voidCount = useMemo(
    () => periodItems.filter((i) => i.status === "void").length,
    [periodItems],
  );

  const summary = useMemo(() => summarizePayrollItems(periodItems), [periodItems]);
  const pendingAll = useMemo(
    () => items.filter((i) => i.status === "pending"),
    [items],
  );
  const pendingAllSum = useMemo(
    () => pendingAll.reduce((s, i) => s + i.amount, 0),
    [pendingAll],
  );

  const missingSalary = useMemo(
    () => employees.filter((e) => e.active && !(Number(e.monthlySalary) > 0)).length,
    [employees],
  );

  const showActions = shopView && (isOwner || canPay);

  async function onGenerate(scope: PayrollGenerateScope) {
    if (!isOwner) return;
    setBusy(true);
    try {
      const result = await generatePayrollForPeriod({
        periodMonth,
        employees,
        bonusByEmployee,
        createdBy: actorId,
        schedule,
        scope,
      });
      const scopeLabel =
        scope === "salary" ? "เงินเดือน" : scope === "bonus" ? "โบนัส" : "ทั้งหมด";
      const parts: string[] = [];
      if (result.created > 0) parts.push(`สร้าง ${result.created}`);
      if (result.restored > 0) parts.push(`กู้คืน ${result.restored}`);
      if (parts.length) {
        onInfo?.(
          `${scopeLabel}: ${parts.join(" · ")} รายการรอโอน` +
            (result.skipped ? ` · ข้าม ${result.skipped}` : ""),
        );
      } else if (result.skipped) {
        onInfo?.(
          `${scopeLabel}: ไม่มีรายการใหม่ (ข้าม ${result.skipped} — มีอยู่แล้วหรือยอด 0)`,
        );
      } else {
        onInfo?.(
          scope === "bonus"
            ? "ยังไม่มีโบนัสให้สร้าง — ตรวจสรุปโบนัส/หักก่อน"
            : "ไม่มีรายการให้สร้าง — ตั้งเงินเดือนที่แท็บตั้งค่าจ่าย",
        );
      }
    } catch (err) {
      onError((err as Error).message || "สร้างรายการไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function onConfirmPay() {
    if (!payTarget || !canPay) return;
    setBusy(true);
    try {
      await markPayrollPaid({
        id: payTarget.item.id,
        paidBy: actorId,
        slipUrls: payTarget.slipUrls,
        note: payTarget.note,
        prodEntries,
        otEntries,
      });
      setPayTarget(null);
      onInfo?.(`จ่ายแล้ว · ${payrollDescription(payTarget.item)}`);
    } catch (err) {
      onError((err as Error).message || "บันทึกจ่ายไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function onVoid(item: PayrollItem) {
    if (!isOwner) return;
    if (
      !window.confirm(
        `ยกเลิกรายการนี้?\n${payrollDescription(item)}\n\nยังไม่จ่าย — กู้คืนหรือกดสร้างรายการใหม่ได้ภายหลัง`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await voidPayrollItem(item.id, actorId);
      onInfo?.("ยกเลิกแล้ว (ยังไม่จ่าย) — กดกู้คืนหรือสร้างรายการใหม่ได้");
    } catch (err) {
      onError((err as Error).message || "ยกเลิกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function onRestore(item: PayrollItem) {
    if (!isOwner) return;
    setBusy(true);
    try {
      await restorePayrollItem(item.id);
      onInfo?.(`กู้คืนแล้ว · ${payrollDescription(item)}`);
    } catch (err) {
      onError((err as Error).message || "กู้คืนไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="payroll-panel">
      <div className={`payroll-summary-bar${shopView ? "" : " payroll-summary-bar--solo"}`}>
        <div>
          <span className="bonus-summary-label">
            {shopView ? "รอโอนเดือนนี้" : "ของฉัน · รอโอนเดือนนี้"}
          </span>
          <strong>฿{fmt(summary.pendingSum)}</strong>
          <span className="muted bonus-summary-pool-meta">
            {summary.pendingCount} รายการ · จ่ายแล้ว ฿{fmt(summary.paidSum)}
          </span>
        </div>
        {shopView ? (
          <div>
            <span className="bonus-summary-label">คิวทั้งร้าน</span>
            <strong>฿{fmt(pendingAllSum)}</strong>
            <span className="muted bonus-summary-pool-meta">{pendingAll.length} รายการรอ</span>
          </div>
        ) : null}
      </div>

      {isOwner ? (
        <div className="payroll-actions">
          <div className="payroll-actions-row">
            <button
              type="button"
              className="primary-btn"
              disabled={busy}
              onClick={() => void onGenerate("salary")}
            >
              {busy ? "..." : "สร้างเงินเดือน"}
            </button>
            <button
              type="button"
              className="ghost-btn"
              disabled={busy}
              onClick={() => void onGenerate("bonus")}
              title="สร้างหลังหักโบนัสนิ่งแล้ว"
            >
              สร้างโบนัส
            </button>
          </div>
          <p className="muted payroll-actions-hint">
            แยกสร้าง: เงินเดือนได้เลย · โบนัสรอหักนิ่งก่อน · สิ้นเดือนลงบัญชีวันสิ้นเดือน (โอนวันที่{" "}
            {schedule.salarySplits[1]?.dayOfMonth ?? 1}) · หักเบิกค้างอัตโนมัติ · ยกเลิกแล้วกดสร้างใหม่ได้
            {missingSalary
              ? ` · ยังไม่มีเงินเดือน ${missingSalary} คน — ไปแท็บตั้งค่าจ่าย`
              : ""}
          </p>
        </div>
      ) : shopView ? (
        <p className="muted payroll-actions-hint">คิวโอนทั้งร้าน — กดโอนแล้วเมื่อโอนเสร็จ (แนบสลิปได้)</p>
      ) : (
        <p className="muted payroll-actions-hint">
          รายการจ่ายของคุณ · รอเจ้าของโอน — ไม่เห็นยอดคนอื่น
        </p>
      )}

      <div className="payroll-filter" role="tablist" aria-label="กรองรายการจ่าย">
        {(
          [
            ["pending", "รอโอน"],
            ["all", "ทั้งหมด"],
            ["void", voidCount ? `ยกเลิก (${voidCount})` : "ยกเลิก"],
            ["salary_mid", "กลางเดือน"],
            ["salary_month_end", "ปลายเดือน"],
            ["bonus", "โบนัส"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            className={filter === key ? "is-active" : ""}
            aria-selected={filter === key}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {!visible.length ? (
        <p className="empty">
          {shopView
            ? "ยังไม่มีรายการในมุมมองนี้ — กดสร้างรายการรอโอน"
            : "ยังไม่มีรายการจ่ายของคุณในเดือนนี้"}
        </p>
      ) : (
        <div className="sheet-scroll payroll-sheet sheet-bleed">
          <table className="sheet-table payroll-table sheet-table--dense">
            <thead>
              <tr>
                {shopView ? <th className="payroll-col-name">ชื่อ</th> : null}
                <th className="payroll-col-kind">ประเภท</th>
                <th className="payroll-col-status">สถานะ</th>
                <th className="payroll-col-due">โอน</th>
                <th className="payroll-col-amt col-out">ยอด</th>
                {showActions ? <th className="payroll-col-act col-act" /> : null}
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => {
                const emp = employees.find((e) => e.id === item.employeeId);
                const accountBits = [emp?.payBank, emp?.payAccountNo]
                  .map((s) => (s || "").trim())
                  .filter(Boolean);
                const dueLabel = kindUsesMonthEndAccount(item.kind)
                  ? `${formatDateShort(item.dueDate)}`
                  : formatDateShort(item.dueDate);
                const metaBits: string[] = [];
                if (kindUsesMonthEndAccount(item.kind)) {
                  metaBits.push(`บช.${formatDateShort(item.accountDate || item.dueDate)}`);
                }
                if (item.advanceDeduct > 0) {
                  metaBits.push(`หักเบิก ฿${fmt(item.advanceDeduct)}`);
                }
                if (shopView && accountBits.length) {
                  metaBits.push(accountBits.join(" "));
                }
                return (
                  <tr key={item.id} className={`payroll-tr status-${item.status}`}>
                    {shopView ? (
                      <td className="payroll-col-name">
                        <strong>{item.employeeName}</strong>
                        {metaBits.length ? (
                          <div className="muted payroll-cell-meta">{metaBits.join(" · ")}</div>
                        ) : null}
                      </td>
                    ) : null}
                    <td className="payroll-col-kind">
                      <span title={PAYROLL_KIND_LABELS[item.kind]}>{shortKind(item.kind)}</span>
                      {!shopView && metaBits.length ? (
                        <div className="muted payroll-cell-meta">{metaBits.join(" · ")}</div>
                      ) : null}
                    </td>
                    <td className="payroll-col-status">
                      <span className={`payroll-status status-${item.status}`}>
                        {PAYROLL_STATUS_LABELS[item.status]}
                      </span>
                    </td>
                    <td className="payroll-col-due">{dueLabel}</td>
                    <td className="payroll-col-amt col-out">฿{fmt(item.amount)}</td>
                    {showActions ? (
                      <td className="payroll-col-act col-act">
                        {item.status === "pending" && canPay ? (
                          <div className="payroll-inline-actions">
                            <button
                              type="button"
                              className="primary-btn payroll-table-btn"
                              disabled={busy || (!canPay && item.amount > 0)}
                              title={
                                item.amount > 0 && !canPay ? "ต้องมีสิทธิ์บช.เจ้าของ" : undefined
                              }
                              onClick={() =>
                                setPayTarget({
                                  item,
                                  slipUrls: [...item.slipUrls],
                                  note: item.note,
                                })
                              }
                            >
                              {item.amount > 0 ? "โอน" : "เคลียร์"}
                            </button>
                            {isOwner ? (
                              <button
                                type="button"
                                className="ghost-btn payroll-table-btn"
                                disabled={busy}
                                onClick={() => void onVoid(item)}
                              >
                                ยกเลิก
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                        {item.status === "void" && isOwner ? (
                          <button
                            type="button"
                            className="primary-btn payroll-table-btn"
                            disabled={busy}
                            onClick={() => void onRestore(item)}
                          >
                            กู้คืน
                          </button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {payTarget ? (
        <div className="modal-backdrop edit-modal is-module-form" onClick={() => setPayTarget(null)}>
          <div
            className="modal-card module-form-card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="ยืนยันการโอน"
          >
            <h2 className="panel-title" style={{ fontSize: "1rem", marginBottom: "0.65rem" }}>
              ยืนยันโอน · ฿{fmt(payTarget.item.amount)}
            </h2>
            <p className="muted" style={{ marginBottom: "0.75rem" }}>
              {payrollDescription(payTarget.item)}
            </p>
            <PhotoAttachMultiField
              label="สลิปโอน"
              values={payTarget.slipUrls}
              onChange={(urls) => setPayTarget((t) => (t ? { ...t, slipUrls: urls } : t))}
              onError={onError}
              max={PAYROLL_SLIP_MAX}
              storageFolder="payroll"
              storageSlotKey={payTarget.item.id}
              hint="แนบสลิปหลังโอน (ถ้ามี)"
            />
            <label className="field" style={{ marginTop: "0.75rem" }}>
              <span>หมายเหตุ</span>
              <input
                value={payTarget.note}
                onChange={(e) =>
                  setPayTarget((t) => (t ? { ...t, note: e.target.value } : t))
                }
                placeholder="optional"
              />
            </label>
            <p className="muted form-hint-inline">
              จะลงบช.เจ้าของเป็นค่าใช้จ่าย (sga)
              {payTarget.item.kind === "bonus"
                ? " และล็อกแถวผลิต/ชงของคนนี้ในเดือนอ้างอิง"
                : ""}
            </p>
            <div className="module-form-actions">
              <button
                type="button"
                className="ghost-btn"
                disabled={busy}
                onClick={() => setPayTarget(null)}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="primary-btn"
                disabled={busy || !canPay}
                onClick={() => void onConfirmPay()}
              >
                {busy ? "กำลังบันทึก..." : "ยืนยันจ่าย"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
