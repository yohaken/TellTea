"use client";

import { useMemo, useState } from "react";
import { EntryPhotoIndicator, ImagePreviewModal } from "@/components/EntryPhotoCell";
import { PhotoAttachMultiField } from "@/components/PhotoAttachMultiField";
import {
  StaffLatestTransferCard,
  type StaffBonusExplain,
} from "@/components/StaffLatestTransferCard";
import { listActiveEmployeesWithPay, type Employee } from "@/lib/employees";
import type { OtEntry } from "@/lib/ot";
import {
  comparePayrollQueueRows,
  createSpecialPayrollItem,
  generatePayrollForPeriod,
  groupPendingPayrollByEmployee,
  isCombinedPairLine,
  kindUsesMonthEndAccount,
  listPendingMonthEndBonusPairs,
  markPayrollPaid,
  markPayrollPaidCombined,
  PAYROLL_KIND_LABELS,
  PAYROLL_SLIP_MAX,
  PAYROLL_STATUS_LABELS,
  payrollDescription,
  pendingPayrollNeedingAdvanceRefresh,
  recordEmployeeAdvance,
  restorePayrollItem,
  summarizePayrollItems,
  voidPayrollItem,
  type BonusAmountByEmployee,
  type PayrollGenerateScope,
  type PayrollItem,
  type PayrollKind,
  type PayrollMonthEndBonusPair,
  type PayrollSchedule,
} from "@/lib/payroll";
import { buildCombinedTransferClipboard } from "@/lib/payroll-staff-receipt";
import type { ProdEntry } from "@/lib/production";
import {
  formatDateShortBe,
  formatPlainNumber,
  parseDateInput,
  todayInputValue,
} from "@/lib/utils";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

function fmt(n: number) {
  return formatPlainNumber(n);
}

type PayTarget = {
  mode: "single" | "combined";
  item: PayrollItem;
  pair?: PayrollMonthEndBonusPair;
  slipUrls: string[];
  note: string;
};

type SpecialDraft = {
  employeeId: string;
  amount: string;
  note: string;
  skipGroup: boolean;
};

type AdvanceDraft = {
  employeeId: string;
  amount: string;
  date: string;
  note: string;
  slipUrls: string[];
  voidPendingThenHint: boolean;
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
  bonusExplain,
  onOpenBonusMonth,
  onOpenHistory,
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
  /** อธิบายหักโบนัสงวดที่เลือก — มุมพนักงาน */
  bonusExplain?: StaffBonusExplain | null;
  onOpenBonusMonth?: (periodMonth: string) => void;
  onOpenHistory?: (periodMonth: string) => void;
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
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [advanceDraft, setAdvanceDraft] = useState<AdvanceDraft>({
    employeeId: "",
    amount: "",
    date: todayInputValue(),
    note: "",
    slipUrls: [],
    voidPendingThenHint: true,
  });
  const [slipPreview, setSlipPreview] = useState<{
    urls: string[];
    title: string;
  } | null>(null);

  useBodyScrollLock(!!payTarget || specialOpen || advanceOpen || !!slipPreview);

  const periodItems = useMemo(
    () => items.filter((i) => i.periodMonth === periodMonth),
    [items, periodMonth],
  );

  const visible = useMemo(() => {
    let rows = periodItems;
    if (filter === "pending") rows = rows.filter((i) => i.status === "pending");
    else if (filter === "void") rows = rows.filter((i) => i.status === "void");
    else if (filter !== "all") rows = rows.filter((i) => i.kind === filter);
    return [...rows].sort(comparePayrollQueueRows);
  }, [periodItems, filter]);

  const combinedPairs = useMemo(
    () => listPendingMonthEndBonusPairs(periodItems, periodMonth),
    [periodItems, periodMonth],
  );
  const combinedPairByEmp = useMemo(() => {
    const map = new Map<string, PayrollMonthEndBonusPair>();
    for (const p of combinedPairs) map.set(p.employeeId, p);
    return map;
  }, [combinedPairs]);

  const pendingGroups = useMemo(
    () => groupPendingPayrollByEmployee(periodItems, periodMonth),
    [periodItems, periodMonth],
  );
  const useGroupedPending = shopView && filter === "pending";

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

  const advancePendingRows = useMemo(() => {
    if (!advanceDraft.employeeId) return [];
    return pendingPayrollNeedingAdvanceRefresh(
      periodItems,
      advanceDraft.employeeId,
      periodMonth,
    );
  }, [advanceDraft.employeeId, periodItems, periodMonth]);

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

  function openAdvanceForm(employeeId?: string) {
    setAdvanceDraft({
      employeeId: employeeId || activeRoster[0]?.id || "",
      amount: "",
      date: todayInputValue(),
      note: "",
      slipUrls: [],
      voidPendingThenHint: true,
    });
    setAdvanceOpen(true);
  }

  async function onRecordAdvance() {
    if (!isOwner) return;
    const emp = activeRoster.find((e) => e.id === advanceDraft.employeeId);
    if (!emp) {
      onError("เลือกพนักงานก่อน");
      return;
    }
    const amountNum = Number(advanceDraft.amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      onError("ใส่ยอดเบิกให้ถูกต้อง");
      return;
    }
    let dateMs: number;
    try {
      dateMs = parseDateInput(advanceDraft.date);
    } catch {
      onError("ใส่วันที่เบิกให้ถูกต้อง");
      return;
    }
    setBusy(true);
    try {
      const result = await recordEmployeeAdvance({
        employeeId: emp.id,
        employeeName: emp.name,
        amount: amountNum,
        createdBy: actorId,
        date: dateMs,
        note: advanceDraft.note,
        slipUrls: advanceDraft.slipUrls,
        postToBooks: true,
      });

      let voided = 0;
      if (advanceDraft.voidPendingThenHint && advancePendingRows.length) {
        for (const row of advancePendingRows) {
          await voidPayrollItem(row.id, actorId);
          voided += 1;
        }
      }

      const refreshed = await listActiveEmployeesWithPay();
      onEmployeesChange?.(refreshed);
      setAdvanceOpen(false);
      setFilter("pending");
      const noSalary = !(Number(emp.monthlySalary) > 0);
      onInfo?.(
        `บันทึกเบิก · ${emp.name} · ฿${fmt(amountNum)} · ค้างหัก ฿${fmt(result.advanceBalance)} · ลงบช.เจ้าของแล้ว` +
          (advanceDraft.slipUrls.length ? " · มีสลิป" : "") +
          (voided > 0 ? ` · ยกเลิกคิวเก่า ${voided}` : "") +
          " · เปิดเข้ารอบกลุ่มแล้ว" +
          (noSalary
            ? " · ยังไม่ตั้งเงินเดือน — ไปตั้งค่าจ่ายใส่ยอดก่อน แล้วค่อยสร้างเงินเดือน"
            : " · กด「สร้างเงินเดือน」แล้วดูแท็บรอโอน"),
      );
    } catch (err) {
      onError((err as Error).message || "บันทึกเบิกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
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
        const refreshed = await listActiveEmployeesWithPay();
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
      // โหลดเงินเดือน/เบิกค้างล่าสุดก่อนสร้าง — กันคิวไม่หักหลังบันทึกเบิก
      const freshEmployees = await listActiveEmployeesWithPay();
      onEmployeesChange?.(freshEmployees);
      const result = await generatePayrollForPeriod({
        periodMonth,
        employees: freshEmployees,
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
      if (result.updated > 0) parts.push(`อัปเดตหักเบิก ${result.updated}`);
      if (result.forceIncludedNames.length) {
        parts.push(
          `รวมคนมีเบิกค้าง ${result.forceIncludedNames.slice(0, 4).join(", ")}`,
        );
      }
      const issueNote = result.issues.length
        ? " · " +
          result.issues
            .slice(0, 4)
            .map((i) => `${i.employeeName}: ${i.reason}`)
            .join(" | ") +
          (result.issues.length > 4 ? ` (+${result.issues.length - 4})` : "")
        : "";
      const skipGroupNote = result.skippedGroupNames.length
        ? ` · ข้ามรอบกลุ่ม: ${result.skippedGroupNames.slice(0, 5).join(", ")}` +
          (result.skippedGroupNames.length > 5
            ? ` (+${result.skippedGroupNames.length - 5})`
            : "") +
          " — ปิดติ๊กที่ตั้งค่าจ่าย"
        : "";
      setFilter("pending");
      if (parts.length) {
        onInfo?.(
          `${scopeLabel}: ${parts.join(" · ")} → ดูแท็บรอโอน` +
            (result.skipped ? ` · ข้าม ${result.skipped}` : "") +
            skipGroupNote +
            issueNote,
        );
      } else if (issueNote || result.skipped) {
        onInfo?.(
          `${scopeLabel}: ไม่มีคิวใหม่` +
            (result.skipped ? ` (ข้าม ${result.skipped})` : "") +
            skipGroupNote +
            issueNote,
        );
      } else {
        onInfo?.(
          scope === "bonus"
            ? "ยังไม่มีโบนัสให้สร้าง — ตรวจสรุปโบนัส/หักก่อน"
            : "ไม่มีรายการให้สร้าง — ตั้งเงินเดือนที่แท็บตั้งค่าจ่าย" + skipGroupNote,
        );
      }
    } catch (err) {
      onError((err as Error).message || "สร้างรายการไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  function openSinglePay(item: PayrollItem) {
    setPayTarget({
      mode: "single",
      item,
      slipUrls: [...item.slipUrls],
      note: item.note,
    });
  }

  function openCombinedPay(pair: PayrollMonthEndBonusPair) {
    setPayTarget({
      mode: "combined",
      item: pair.salary,
      pair,
      slipUrls: [...pair.salary.slipUrls, ...pair.bonus.slipUrls].filter(
        (u, i, arr) => u && arr.indexOf(u) === i,
      ),
      note: "",
    });
  }

  async function copyCombinedTransfer(pair: PayrollMonthEndBonusPair) {
    const emp = employees.find((e) => e.id === pair.employeeId);
    const text = buildCombinedTransferClipboard({
      employeeName: pair.employeeName,
      payBank: emp?.payBank,
      payAccountNo: emp?.payAccountNo,
      payAccountName: emp?.payAccountName,
      transferTotal: pair.transferTotal,
      salaryAmount: pair.salary.amount,
      bonusAmount: pair.bonus.amount,
      advanceDeduct: pair.salary.advanceDeduct,
    });
    try {
      await navigator.clipboard.writeText(text);
      onInfo?.("คัดลอกแล้ว · ชื่อ บัญชี ยอดโอนรวม — วางในแอปธนาคารได้");
    } catch {
      onError("คัดลอกไม่สำเร็จ — ลองเลือกข้อความเอง");
    }
  }

  async function onConfirmPay() {
    if (!payTarget || !canPay) return;
    setBusy(true);
    try {
      if (payTarget.mode === "combined" && payTarget.pair) {
        const result = await markPayrollPaidCombined({
          salaryId: payTarget.pair.salary.id,
          bonusId: payTarget.pair.bonus.id,
          paidBy: actorId,
          slipUrls: payTarget.slipUrls,
          note: payTarget.note,
          prodEntries,
          otEntries,
        });
        setPayTarget(null);
        onInfo?.(
          `โอนรวมแล้ว · ${payTarget.pair.employeeName} · ฿${fmt(result.transferTotal)}` +
            ` (สิ้นเดือน ฿${fmt(payTarget.pair.salary.amount)} + โบนัส ฿${fmt(payTarget.pair.bonus.amount)})`,
        );
      } else {
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
      }
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
            <button
              type="button"
              className="ghost-btn"
              disabled={busy || !activeRoster.length}
              onClick={() => openAdvanceForm()}
              title="บันทึกเบิกล่วงหน้า — วันที่ + สลิป + ลงบช.เจ้าของ แล้วหักจากรอบจ่าย"
            >
              บันทึกเบิก
            </button>
          </div>
          <p className="muted payroll-actions-hint">
            ปิดเดือน: สร้างเงินเดือน → หักโบนัสนิ่ง → สร้างโบนัส →「โอนรวม」สลิปเดียว (คิวยังแยกสิ้นเดือน/โบนัสให้พนักงานเห็น) ·
            อย่ากดโอนเงินเดือนก่อนถ้าจะรวมโบนัส · เบิกก่อนรอบ →「บันทึกเบิก」·
            จ่ายแยก = ยอดกำหนดเอง · สิ้นเดือนลงบัญชีวันสิ้นเดือน (โอนวันที่{" "}
            {schedule.salarySplits[1]?.dayOfMonth ?? 1})
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
          รายการจ่ายของคุณ · รอเจ้าของโอน — ไม่เห็นยอดคนอื่น · ไม่แจ้งแชทตอนโอน
        </p>
      )}

      {!shopView ? (
        <StaffLatestTransferCard
          items={items}
          periodMonth={periodMonth}
          bonusExplain={bonusExplain}
          onOpenBonusMonth={onOpenBonusMonth}
          onOpenHistory={onOpenHistory}
        />
      ) : null}

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

      {shopView && combinedPairs.length > 0 && filter === "pending" ? (
        <p className="muted payroll-combined-hint">
          พร้อมโอนรวม {combinedPairs.length} คน · รวม ฿
          {fmt(combinedPairs.reduce((s, p) => s + p.transferTotal, 0))} — กดปุ่มเขียว「โอนรวม」ต่อคน
          (รายการเงินเดือน/โบนัสยังแยกให้พนักงานเห็น)
        </p>
      ) : null}

      {useGroupedPending ? (
        !pendingGroups.length ? (
          <p className="empty">ยังไม่มีรายการรอโอน — กดสร้างเงินเดือน / สร้างโบนัส</p>
        ) : (
          <div className="payroll-pay-groups" aria-label="คิวรอโอนจัดกลุ่มตามพนักงาน">
            {pendingGroups.map((group) => {
              const emp = employees.find((e) => e.id === group.employeeId);
              const accountBits = [emp?.payBank, emp?.payAccountNo]
                .map((s) => (s || "").trim())
                .filter(Boolean);
              const pair = group.pair;
              return (
                <article key={group.employeeId} className="payroll-pay-group">
                  <header className="payroll-pay-group-head">
                    <div className="payroll-pay-group-who">
                      <h3 className="payroll-pay-group-name">{group.employeeName}</h3>
                      <p className="muted payroll-pay-group-meta">
                        {pair
                          ? `โอนรวมสิ้นเดือน+โบนัส ฿${fmt(pair.transferTotal)}`
                          : `รอโอน ฿${fmt(group.groupTotal)}`}
                        {accountBits.length ? ` · ${accountBits.join(" ")}` : ""}
                        {group.items.length > (pair ? 2 : 0) && pair
                          ? ` · อื่นๆในคิว ฿${fmt(
                              group.groupTotal - pair.transferTotal,
                            )}`
                          : ""}
                      </p>
                    </div>
                    {pair && canPay ? (
                      <button
                        type="button"
                        className="payroll-combined-btn"
                        disabled={busy}
                        title={`โอนครั้งเดียว ฿${fmt(pair.transferTotal)} · สิ้นเดือน+โบนัส · สลิปเดียว`}
                        onClick={() => openCombinedPay(pair)}
                      >
                        โอนรวม
                        <span className="payroll-combined-btn-amt">
                          ฿{fmt(pair.transferTotal)}
                        </span>
                      </button>
                    ) : null}
                  </header>
                  <ul className="payroll-pay-group-lines">
                    {group.items.map((item) => {
                      const inCombined = isCombinedPairLine(item, pair);
                      const lineMeta: string[] = [];
                      if (item.advanceDeduct > 0) {
                        lineMeta.push(`หักเบิก ฿${fmt(item.advanceDeduct)}`);
                      }
                      if (kindUsesMonthEndAccount(item.kind)) {
                        lineMeta.push(
                          `บช.${formatDateShortBe(item.accountDate || item.dueDate)}`,
                        );
                      }
                      return (
                        <li key={item.id} className="payroll-pay-group-line">
                          <div className="payroll-pay-group-line-main">
                            <span className="payroll-pay-group-kind">
                              {shortKind(item.kind)}
                              {inCombined ? (
                                <span className="payroll-pay-group-tag">รวมโอน</span>
                              ) : null}
                            </span>
                            <strong className="payroll-pay-group-amt">
                              ฿{fmt(item.amount)}
                            </strong>
                          </div>
                          {lineMeta.length ? (
                            <div className="muted payroll-cell-meta">
                              {lineMeta.join(" · ")}
                            </div>
                          ) : null}
                          <div className="payroll-pay-group-line-actions">
                            {item.slipUrls.length ? (
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
                            ) : null}
                            {/* มีคู่โอนรวมแล้ว — ไม่โชว์โอนแยกบนสิ้นเดือน/โบนัส */}
                            {!inCombined && canPay ? (
                              <button
                                type="button"
                                className="ghost-btn payroll-table-btn"
                                disabled={busy}
                                onClick={() => openSinglePay(item)}
                              >
                                {item.amount > 0 ? "โอนแยก" : "เคลียร์"}
                              </button>
                            ) : null}
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
                        </li>
                      );
                    })}
                  </ul>
                </article>
              );
            })}
          </div>
        )
      ) : !visible.length ? (
        <p className="empty">
          {shopView
            ? "ยังไม่มีรายการในมุมมองนี้ — กดสร้างรายการรอโอน"
            : filter === "pending"
              ? "ไม่มีรายการรอโอนในเดือนนี้ — ดูรอบล่าสุดด้านบน หรือแท็บทั้งหมด / ประวัติ"
              : "ยังไม่มีรายการจ่ายของคุณในมุมมองนี้"}
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
                const pair = combinedPairByEmp.get(item.employeeId);
                const inCombined =
                  item.status === "pending" && isCombinedPairLine(item, pair || null);
                const metaBits: string[] = [];
                if (kindUsesMonthEndAccount(item.kind)) {
                  metaBits.push(`บช.${formatDateShortBe(item.accountDate || item.dueDate)}`);
                }
                if (item.advanceDeduct > 0) {
                  metaBits.push(`หักเบิก ฿${fmt(item.advanceDeduct)}`);
                }
                if (item.combinedPayId) {
                  metaBits.push("โอนรวมสิ้นเดือน+โบนัส");
                }
                if (!shopView && item.note.trim()) {
                  metaBits.push(item.note.trim());
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
                            {inCombined && pair && item.kind === "salary_month_end" ? (
                              <button
                                type="button"
                                className="payroll-combined-btn payroll-combined-btn--compact"
                                disabled={busy}
                                onClick={() => openCombinedPay(pair)}
                              >
                                โอนรวม ฿{fmt(pair.transferTotal)}
                              </button>
                            ) : null}
                            {!inCombined ? (
                              <button
                                type="button"
                                className="primary-btn payroll-table-btn"
                                disabled={busy || (!canPay && item.amount > 0)}
                                onClick={() => openSinglePay(item)}
                              >
                                {item.amount > 0 ? "โอน" : "เคลียร์"}
                              </button>
                            ) : null}
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
              {payTarget.mode === "combined" && payTarget.pair
                ? `ยืนยันโอนรวม · ฿${fmt(payTarget.pair.transferTotal)}`
                : `ยืนยันโอน · ฿${fmt(payTarget.item.amount)}`}
            </h2>
            {payTarget.mode === "combined" && payTarget.pair ? (
              <div className="muted" style={{ marginBottom: "0.75rem" }}>
                <p style={{ margin: "0 0 0.35rem" }}>
                  {payTarget.pair.employeeName} · โอนครั้งเดียว สลิปเดียว
                </p>
                {(() => {
                  const emp = employees.find(
                    (e) => e.id === payTarget.pair!.employeeId,
                  );
                  const bankBits = [emp?.payBank, emp?.payAccountNo]
                    .map((s) => (s || "").trim())
                    .filter(Boolean);
                  return bankBits.length ? (
                    <p style={{ margin: "0 0 0.35rem" }}>
                      บัญชี {bankBits.join(" ")}
                      {emp?.payAccountName
                        ? ` · ${emp.payAccountName}`
                        : ""}
                    </p>
                  ) : (
                    <p style={{ margin: "0 0 0.35rem" }}>
                      ยังไม่มีเลขบัญชีในตั้งค่าจ่าย — ใส่ก่อนโอนจะคัดลอกง่ายขึ้น
                    </p>
                  );
                })()}
                <ul className="payroll-combined-breakdown">
                  <li>
                    สิ้นเดือน ฿{fmt(payTarget.pair.salary.amount)}
                    {payTarget.pair.salary.advanceDeduct > 0
                      ? ` (หักเบิก ฿${fmt(payTarget.pair.salary.advanceDeduct)})`
                      : ""}
                  </li>
                  <li>โบนัส ฿{fmt(payTarget.pair.bonus.amount)}</li>
                </ul>
                <p style={{ margin: "0.35rem 0 0" }}>
                  พนักงานยังเห็น 2 รายการแยกในคิวของตัวเอง
                </p>
                <button
                  type="button"
                  className="ghost-btn"
                  style={{ marginTop: "0.5rem" }}
                  disabled={busy}
                  onClick={() => void copyCombinedTransfer(payTarget.pair!)}
                >
                  คัดลอกบัญชี + ยอดโอน
                </button>
              </div>
            ) : (
              <p className="muted" style={{ marginBottom: "0.75rem" }}>
                {payrollDescription(payTarget.item)}
              </p>
            )}
            <PhotoAttachMultiField
              label="สลิปโอน"
              values={payTarget.slipUrls}
              onChange={(urls) => setPayTarget((t) => (t ? { ...t, slipUrls: urls } : t))}
              onError={onError}
              max={PAYROLL_SLIP_MAX}
              storageFolder="payroll"
              storageSlotKey={
                payTarget.mode === "combined" && payTarget.pair
                  ? `${payTarget.pair.salary.id}_combined`
                  : payTarget.item.id
              }
              hint={
                payTarget.mode === "combined"
                  ? "แนบสลิปหลังโอนยอดรวม (ติดทั้ง 2 รายการ)"
                  : "แนบสลิปหลังโอน (ถ้ามี)"
              }
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
              {payTarget.mode === "combined"
                ? " 2 แถว (สิ้นเดือน + โบนัส) สลิปชุดเดียวกัน"
                : payTarget.item.kind === "bonus"
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
                {busy
                  ? "กำลังบันทึก..."
                  : payTarget.mode === "combined"
                    ? "ยืนยันโอนรวม"
                    : "ยืนยันจ่าย"}
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

      {advanceOpen ? (
        <div
          className="modal-backdrop edit-modal is-module-form"
          onClick={() => !busy && setAdvanceOpen(false)}
        >
          <div
            className="modal-card module-form-card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="บันทึกเบิกล่วงหน้า"
          >
            <h2 className="panel-title" style={{ fontSize: "1rem", marginBottom: "0.45rem" }}>
              บันทึกเบิก · ลงบช.เจ้าของ
            </h2>
            <p className="muted" style={{ marginBottom: "0.75rem" }}>
              จ่ายเงินล่วงหน้า (เช่น วันที่ 28) — ระบบเพิ่มเบิกค้าง หักจากรอบจ่ายถัดไป · สลิปไปโพสต์บช.ส่วนตัว
            </p>
            <label className="field">
              <span>พนักงาน</span>
              <select
                value={advanceDraft.employeeId}
                onChange={(e) =>
                  setAdvanceDraft((d) => ({ ...d, employeeId: e.target.value }))
                }
                disabled={busy}
              >
                {activeRoster.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                    {Number(emp.advanceBalance) > 0
                      ? ` · ค้าง ฿${fmt(Number(emp.advanceBalance))}`
                      : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>วันที่เบิก</span>
              <input
                type="date"
                value={advanceDraft.date}
                onChange={(e) =>
                  setAdvanceDraft((d) => ({ ...d, date: e.target.value }))
                }
                disabled={busy}
                required
              />
            </label>
            <label className="field">
              <span>ยอดเบิก (บาท)</span>
              <input
                type="number"
                min={0.01}
                step={100}
                inputMode="decimal"
                value={advanceDraft.amount}
                onChange={(e) =>
                  setAdvanceDraft((d) => ({ ...d, amount: e.target.value }))
                }
                disabled={busy}
                placeholder="เช่น 7500"
                autoFocus
              />
            </label>
            <label className="field">
              <span>หมายเหตุ</span>
              <input
                value={advanceDraft.note}
                onChange={(e) =>
                  setAdvanceDraft((d) => ({ ...d, note: e.target.value }))
                }
                disabled={busy}
                placeholder="optional"
              />
            </label>
            <PhotoAttachMultiField
              label="สลิปโอน/จ่ายเบิก"
              values={advanceDraft.slipUrls}
              onChange={(urls) => setAdvanceDraft((d) => ({ ...d, slipUrls: urls }))}
              onError={onError}
              max={PAYROLL_SLIP_MAX}
              storageFolder="payroll"
              storageSlotKey={`advance-${advanceDraft.employeeId || "new"}`}
              hint="แนบสลิป — ไปกับแถวบช.เจ้าของ"
            />
            {advancePendingRows.length ? (
              <label className="payroll-special-skip" style={{ marginTop: "0.65rem" }}>
                <input
                  type="checkbox"
                  checked={advanceDraft.voidPendingThenHint}
                  onChange={(e) =>
                    setAdvanceDraft((d) => ({
                      ...d,
                      voidPendingThenHint: e.target.checked,
                    }))
                  }
                  disabled={busy}
                />
                ยกเลิกคิวรอโอนของคนนี้ในเดือนนี้ ({advancePendingRows.length} รายการที่ยังไม่หักเบิก)
                — แล้วกดสร้างเงินเดือนใหม่ให้หัก
              </label>
            ) : (
              <p className="muted form-hint-inline" style={{ marginTop: "0.65rem" }}>
                ยังไม่มีคิวรอโอนที่ต้องรีเซ็ต — หลังบันทึกกด「สร้างเงินเดือน」ได้เลยถ้ายังไม่สร้าง
              </p>
            )}
            <div className="module-form-actions">
              <button
                type="button"
                className="ghost-btn"
                disabled={busy}
                onClick={() => setAdvanceOpen(false)}
              >
                ออก
              </button>
              <button
                type="button"
                className="primary-btn"
                disabled={busy}
                onClick={() => void onRecordAdvance()}
              >
                {busy ? "กำลังบันทึก..." : "บันทึกเบิก + ลงบช."}
              </button>
            </div>
          </div>
        </div>
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
