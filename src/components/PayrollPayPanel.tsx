"use client";

import { useMemo, useState } from "react";
import { PhotoAttachMultiField } from "@/components/PhotoAttachMultiField";
import type { Employee } from "@/lib/employees";
import type { OtEntry } from "@/lib/ot";
import {
  generatePayrollForPeriod,
  markPayrollPaid,
  PAYROLL_KIND_LABELS,
  PAYROLL_SLIP_MAX,
  PAYROLL_STATUS_LABELS,
  payrollDescription,
  restorePayrollItem,
  summarizePayrollItems,
  voidPayrollItem,
  type BonusAmountByEmployee,
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

export function PayrollPayPanel({
  isOwner,
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

  async function onGenerate() {
    if (!isOwner) return;
    setBusy(true);
    try {
      const result = await generatePayrollForPeriod({
        periodMonth,
        employees,
        bonusByEmployee,
        createdBy: actorId,
        schedule,
      });
      const parts: string[] = [];
      if (result.created > 0) parts.push(`สร้าง ${result.created}`);
      if (result.restored > 0) parts.push(`กู้คืน ${result.restored}`);
      if (parts.length) {
        onInfo?.(
          `${parts.join(" · ")} รายการรอโอน` +
            (result.skipped ? ` · ข้าม ${result.skipped}` : ""),
        );
      } else if (result.skipped) {
        onInfo?.(
          `ไม่มีรายการใหม่ (ข้าม ${result.skipped} — มีอยู่แล้วหรือยอด 0)`,
        );
      } else {
        onInfo?.("ไม่มีรายการให้สร้าง — ตั้งเงินเดือนหรือมีโบนัสก่อน");
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
      <div className="payroll-summary-bar">
        <div>
          <span className="bonus-summary-label">รอโอนเดือนนี้</span>
          <strong>฿{fmt(summary.pendingSum)}</strong>
          <span className="muted bonus-summary-pool-meta">
            {summary.pendingCount} รายการ · จ่ายแล้ว ฿{fmt(summary.paidSum)}
          </span>
        </div>
        <div>
          <span className="bonus-summary-label">คิวทั้งร้าน</span>
          <strong>฿{fmt(pendingAllSum)}</strong>
          <span className="muted bonus-summary-pool-meta">{pendingAll.length} รายการรอ</span>
        </div>
      </div>

      {isOwner ? (
        <div className="payroll-actions">
          <button
            type="button"
            className="primary-btn"
            disabled={busy}
            onClick={() => void onGenerate()}
          >
            {busy ? "..." : "สร้างรายการรอโอน"}
          </button>
          <p className="muted payroll-actions-hint">
            เงินเดือนตามตาราง ({schedule.salarySplits.map((s) => `${s.percent}%`).join(" + ")})
            + โบนัสคงเหลือ · ไม่ทับรายการรอโอน/จ่ายแล้ว · รายการที่ยกเลิกจะถูกกู้คืนอัตโนมัติ
            {missingSalary
              ? ` · ยังไม่มีเงินเดือน ${missingSalary} คน — ไปแท็บตั้งค่าจ่าย`
              : ""}
          </p>
        </div>
      ) : (
        <p className="muted payroll-actions-hint">รายการรอเจ้าของโอน — พนักงานดูได้อย่างเดียว</p>
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
        <p className="empty">ยังไม่มีรายการในมุมมองนี้ — กดสร้างรายการรอโอน</p>
      ) : (
        <ul className="payroll-list">
          {visible.map((item) => {
            const emp = employees.find((e) => e.id === item.employeeId);
            const accountBits = [
              emp?.payBank,
              emp?.payAccountNo,
              emp?.payAccountName,
            ]
              .map((s) => (s || "").trim())
              .filter(Boolean);
            return (
              <li key={item.id} className={`payroll-row status-${item.status}`}>
                <div className="payroll-row-main">
                  <div className="payroll-row-head">
                    <strong>{item.employeeName}</strong>
                    <span className={`payroll-status status-${item.status}`}>
                      {PAYROLL_STATUS_LABELS[item.status]}
                    </span>
                  </div>
                  <div className="payroll-row-meta muted">
                    {PAYROLL_KIND_LABELS[item.kind]} · ครบ {formatDateShort(item.dueDate)}
                    {accountBits.length ? ` · ${accountBits.join(" · ")}` : ""}
                  </div>
                  <div className="payroll-row-amt">฿{fmt(item.amount)}</div>
                </div>
                {item.status === "pending" && isOwner ? (
                  <div className="payroll-row-actions">
                    <button
                      type="button"
                      className="primary-btn"
                      disabled={busy || !canPay}
                      title={canPay ? undefined : "ต้องมีสิทธิ์บช.เจ้าของ"}
                      onClick={() =>
                        setPayTarget({
                          item,
                          slipUrls: [...item.slipUrls],
                          note: item.note,
                        })
                      }
                    >
                      โอนแล้ว
                    </button>
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={busy}
                      onClick={() => void onVoid(item)}
                    >
                      ยกเลิก
                    </button>
                  </div>
                ) : null}
                {item.status === "void" && isOwner ? (
                  <div className="payroll-row-actions">
                    <button
                      type="button"
                      className="primary-btn"
                      disabled={busy}
                      onClick={() => void onRestore(item)}
                    >
                      กู้คืน
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
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
