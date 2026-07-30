"use client";

import { useMemo, useState } from "react";
import { EntryPhotoIndicator, ImagePreviewModal } from "@/components/EntryPhotoCell";
import { PhotoAttachMultiField } from "@/components/PhotoAttachMultiField";
import { listActiveEmployees, type Employee } from "@/lib/employees";
import type { OtEntry } from "@/lib/ot";
import {
  createSpecialPayrollItem,
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
import { formatDateShortBe, formatPlainNumber } from "@/lib/utils";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

function fmt(n: number) {
  return formatPlainNumber(n);
}

type PayTarget = {
  item: PayrollItem;
  slipUrls: string[];
  note: string;
};

type SpecialDraft = {
  employeeId: string;
  amount: string;
  note: string;
  skipGroup: boolean;
};

function shortKind(kind: PayrollKind): string {
  if (kind === "salary_mid") return "กลางเดือน";
  if (kind === "salary_month_end") return "สิ้นเดือน";
  if (kind === "salary_special") return "จ่ายแยก";
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
  onEmployeesChange,
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
  onEmployeesChange?: (emps: Employee[]) => void;
}) {
  const [filter, setFilter] = useState<"pending" | "all" | "void" | PayrollKind>("pending");
  const [busy, setBusy] = useState(false);
  const [payTarget, setPayTarget] = useState<PayTarget | null>(null);
  const [specialOpen, setSpecialOpen] = useState(false);
  const [specialDraft, setSpecialDraft] = useState<SpecialDraft>({
    employeeId: "",
    amount: "",
    note: "",
    skipGroup: true,
  });
  const [slipPreview, setSlipPreview] = useState<{
    urls: string[];
    title: string;
  } | null>(null);

  useBodyScrollLock(!!payTarget || specialOpen || !!slipPreview);

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
  const skipGroupCount = useMemo(
    () => employees.filter((e) => e.active && e.skipGroupPayroll).length,
    [employees],
  );
  const activeRoster = useMemo(
    () =>
      [...employees]
        .filter((e) => e.active)
        .sort((a, b) => a.name.localeCompare(b.name, "th")),
    [employees],
  );

  const showActions = shopView && (isOwner || canPay);

  function openSpecialForm() {
    setSpecialDraft({
      employeeId: activeRoster[0]?.id || "",
      amount: "",
      note: "",
      skipGroup: true,
    });
    setSpecialOpen(true);
  }

  async function onCreateSpecial() {
    if (!isOwner) return;
    const emp = activeRoster.find((e) => e.id === specialDraft.employeeId);
    if (!emp) {
      onError("เลือกพนักงานก่อน");
      return;
    }
    const amountNum = Number(specialDraft.amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      onError("ใส่ยอดจ่ายแยกให้ถูกต้อง");
      return;
    }
    setBusy(true);
    try {
      await createSpecialPayrollItem({
        employee: emp,
        periodMonth,
        grossAmount: amountNum,
        createdBy: actorId,
        note: specialDraft.note,
        markSkipGroupPayroll: specialDraft.skipGroup,
      });
      if (specialDraft.skipGroup || onEmployeesChange) {
        const refreshed = await listActiveEmployees();
        onEmployeesChange?.(refreshed);
      }
      setSpecialOpen(false);
      setFilter("pending");
      onInfo?.(
        `สร้างจ่ายแยก · ${emp.name} · ฿${fmt(amountNum)}` +
          (specialDraft.skipGroup ? " · ข้ามรอบกลุ่มไว้ก่อน" : ""),
      );
    } catch (err) {
      onError((err as Error).message || "สร้างจ่ายแยกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

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
            <button
              type="button"
              className="ghost-btn"
              disabled={busy || !activeRoster.length}
              onClick={openSpecialForm}
              title="พนักงานใหม่ / แปลงประจำ — ใส่ยอดเองเข้าคิวรอโอน"
            >
              จ่ายแยก
            </button>
          </div>
          <p className="muted payroll-actions-hint">
            แยกสร้าง: เงินเดือนได้เลย · โบนัสหลังปิดเดือนที่สรุปโบนัส · สิ้นเดือนลงบัญชีวันสิ้นเดือน (โอนวันที่{" "}
            {schedule.salarySplits[1]?.dayOfMonth ?? 1}) · จ่ายแยก = ยอดกำหนดเองเข้าคิวเดียวกัน ·
            หักเบิกค้างอัตโนมัติ · ยกเลิกแล้วกดสร้างใหม่ได้
            {missingSalary
              ? ` · ยังไม่มีเงินเดือน ${missingSalary} คน — ไปแท็บตั้งค่าจ่าย`
              : ""}
            {skipGroupCount
              ? ` · ข้ามรอบกลุ่ม ${skipGroupCount} คน (ตั้งค่าจ่าย / จ่ายแยก)`
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
            ["salary_special", "จ่ายแยก"],
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
                <th className="payroll-col-slip">สลิป</th>
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
                  ? `${formatDateShortBe(item.dueDate)}`
                  : formatDateShortBe(item.dueDate);
                const metaBits: string[] = [];
                if (kindUsesMonthEndAccount(item.kind)) {
                  metaBits.push(`บช.${formatDateShortBe(item.accountDate || item.dueDate)}`);
                }
                if (item.advanceDeduct > 0) {
                  metaBits.push(`หักเบิก ฿${fmt(item.advanceDeduct)}`);
                }
                if (shopView && accountBits.length) {
                  metaBits.push(accountBits.join(" "));
                }
                const hasSlips = item.slipUrls.length > 0;
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
                    <td className="payroll-col-slip">
                      {hasSlips ? (
                        <EntryPhotoIndicator
                          imageUrls={item.slipUrls}
                          label="สลิป"
                          onView={() =>
                            setSlipPreview({
                              urls: item.slipUrls,
                              title: payrollDescription(item),
                            })
                          }
                        />
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
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

      {slipPreview ? (
        <ImagePreviewModal
          urls={slipPreview.urls}
          title={slipPreview.title}
          onClose={() => setSlipPreview(null)}
        />
      ) : null}

      {specialOpen ? (
        <div
          className="modal-backdrop edit-modal is-module-form"
          onClick={() => !busy && setSpecialOpen(false)}
        >
          <div
            className="modal-card module-form-card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="สร้างจ่ายแยก"
          >
            <h2 className="panel-title" style={{ fontSize: "1rem", marginBottom: "0.45rem" }}>
              จ่ายแยก · ยอดกำหนดเอง
            </h2>
            <p className="muted" style={{ marginBottom: "0.75rem" }}>
              รับพนักงานใหม่ / แปลงประจำก่อนรอบกลุ่ม — ใส่ยอดแล้วเข้าคิวรอโอนเหมือนเงินเดือน
            </p>
            <label className="field">
              <span>พนักงาน</span>
              <select
                value={specialDraft.employeeId}
                onChange={(e) =>
                  setSpecialDraft((d) => ({ ...d, employeeId: e.target.value }))
                }
                disabled={busy}
              >
                {activeRoster.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                    {emp.skipGroupPayroll ? " · ข้ามรอบกลุ่ม" : ""}
                    {Number(emp.monthlySalary) > 0
                      ? ` · เดือน ฿${fmt(Number(emp.monthlySalary))}`
                      : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>ยอดโอน (บาท)</span>
              <input
                type="number"
                min={0.01}
                step={100}
                inputMode="decimal"
                value={specialDraft.amount}
                onChange={(e) =>
                  setSpecialDraft((d) => ({ ...d, amount: e.target.value }))
                }
                disabled={busy}
                placeholder="เช่น 7500"
                autoFocus
              />
            </label>
            <label className="field">
              <span>หมายเหตุ</span>
              <input
                value={specialDraft.note}
                onChange={(e) =>
                  setSpecialDraft((d) => ({ ...d, note: e.target.value }))
                }
                disabled={busy}
                placeholder="เช่น แปลงประจำ · จ่ายก่อนรอบ 1"
              />
            </label>
            <label className="payroll-special-skip">
              <input
                type="checkbox"
                checked={specialDraft.skipGroup}
                onChange={(e) =>
                  setSpecialDraft((d) => ({ ...d, skipGroup: e.target.checked }))
                }
                disabled={busy}
              />
              ยังไม่รวมตอนกด «สร้างเงินเดือน» กลุ่ม (แนะนำ)
            </label>
            <p className="muted form-hint-inline">
              เดือนอ้างอิง {periodMonth} · วันโอน/ลงบัญชี = วันนี้ · หักเบิกค้างถ้ามี
            </p>
            <div className="module-form-actions">
              <button
                type="button"
                className="ghost-btn"
                disabled={busy}
                onClick={() => setSpecialOpen(false)}
              >
                ออก
              </button>
              <button
                type="button"
                className="primary-btn"
                disabled={busy}
                onClick={() => void onCreateSpecial()}
              >
                {busy ? "กำลังสร้าง..." : "สร้างคิวรอโอน"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
