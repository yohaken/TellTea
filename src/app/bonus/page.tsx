"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CircleDollarSign } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { BonusDeductionEvidencePanel } from "@/components/BonusDeductionEvidencePanel";
import { PayrollHistoryPanel } from "@/components/PayrollHistoryPanel";
import { PayrollPayPanel } from "@/components/PayrollPayPanel";
import { PayrollSettingsPanel } from "@/components/PayrollSettingsPanel";
import { useAuth } from "@/lib/auth";
import {
  buildBonusDeductionLines,
  computeShopDeductPct,
  saveBonusDeductionMonthQty,
  saveBonusDeductionRulePct,
  subscribeBonusDeductionMonth,
  subscribeBonusDeductionSettings,
  type BonusDeductionMonthDoc,
  type BonusDeductionRule,
  type BonusDeductionRuleId,
  type BonusDeductionSettings,
} from "@/lib/bonus-deductions";
import {
  computeMonthBonus,
  computePersonalBonusRow,
  namesMatch,
  parseMonthInput,
  pickMyBonusRow,
  thaiMonthYearLabel,
  type MonthBonusReport,
  type WorkerMonthBonus,
} from "@/lib/bonus";
import {
  saveBonusLivePool,
  subscribeBonusLivePool,
  type BonusLivePool,
} from "@/lib/bonus-live-pool";
import { migrateAllBonusCloseSideDocs } from "@/lib/bonus-close-migrate";
import {
  closeBonusMonth,
  reportFromCloseSnapshot,
  subscribeBonusMonthClose,
  unlockBonusMonth,
  type BonusMonthCloseDoc,
} from "@/lib/bonus-month-close";
import {
  subscribeBonusMonthStatus,
  subscribeBonusPersonalClose,
  workerRowFromPersonalClose,
  type BonusMonthStatusDoc,
  type BonusPersonalCloseDoc,
} from "@/lib/bonus-personal-close";
import { RateSchedulePanel } from "@/components/RateSchedulePanel";
import {
  getEmployeeWithPay,
  listActiveEmployees,
  listActiveEmployeesWithPay,
  migrateAllLegacyEmployeePay,
  resolveLinkedEmployee,
  type Employee,
} from "@/lib/employees";
import { can } from "@/lib/permissions";
import { updateStaffProfile } from "@/lib/staff";
import { getOtSettings, subscribeOtEntries, type OtEntry } from "@/lib/ot";
import {
  DEFAULT_PAYROLL_SCHEDULE,
  repairStuckPaidPayrollItems,
  suggestPeriodMonthForToday,
  subscribePayrollItems,
  subscribePayrollSchedule,
  type PayrollItem,
  type PayrollSchedule,
} from "@/lib/payroll";
import { subscribeProdEntries, type ProdEntry } from "@/lib/production";
import { subscribeRateSchedule, type RateScheduleEntry } from "@/lib/rate-schedule";
import { formatDateShortBe, formatPlainNumber } from "@/lib/utils";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

function fmt(n: number) {
  return formatPlainNumber(n);
}

function fmtPct(n: number) {
  return n % 1 === 0 ? `${n.toFixed(0)}%` : `${n.toFixed(2)}%`;
}

type EditTarget =
  | { kind: "rate"; rule: BonusDeductionRule }
  | { kind: "qty"; rule: BonusDeductionRule; qty: number };

type PayTab = "pay" | "bonus" | "history" | "settings";

export default function BonusPage() {
  return (
    <AuthGate>
      <BonusView />
    </AuthGate>
  );
}

function BonusView() {
  const { actorId, staff, realStaff, isPermPreview } = useAuth();
  const router = useRouter();
  /** สิทธิ์จริงของคนล็อกอิน — ไม่ถูกพรีวิวทับ */
  const realIsOwner = realStaff?.role === "owner";
  const realCanPay = realIsOwner || can(realStaff, "payrollPay");
  const [month, setMonth] = useState(() => suggestPeriodMonthForToday());
  const [tab, setTab] = useState<PayTab>("bonus");
  const [otEntries, setOtEntries] = useState<OtEntry[]>([]);
  const [prodEntries, setProdEntries] = useState<ProdEntry[]>([]);
  const [deductionSettings, setDeductionSettings] = useState<BonusDeductionSettings | null>(null);
  const [deductionMonth, setDeductionMonth] = useState<BonusDeductionMonthDoc | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [otSettingsRate, setOtSettingsRate] = useState(0.6);
  const [rateSchedule, setRateSchedule] = useState<RateScheduleEntry[]>([]);
  const [payrollSchedule, setPayrollSchedule] = useState<PayrollSchedule>(DEFAULT_PAYROLL_SCHEDULE);
  const [payrollItems, setPayrollItems] = useState<PayrollItem[]>([]);
  const [livePool, setLivePool] = useState<BonusLivePool | null>(null);
  const [loading, setLoading] = useState(true);
  const [closeBusy, setCloseBusy] = useState(false);
  const [monthClose, setMonthClose] = useState<BonusMonthCloseDoc | null>(null);
  const [monthStatus, setMonthStatus] = useState<BonusMonthStatusDoc | null>(null);
  const [personalClose, setPersonalClose] = useState<BonusPersonalCloseDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [historyEmployeeId, setHistoryEmployeeId] = useState("");

  const canView = can(staff, "bonus") || realCanPay;
  /** โหลดข้อมูลทั้งร้านจากสิทธิ์จริง — พรีวิวแค่สลับ UI */
  const shopPayView = realCanPay;
  /** มุมพนักงานจากไอคอนบน (รวมทั้งแอป) */
  const previewEmployeeId =
    isPermPreview && staff?.employeeId ? staff.employeeId : null;
  const isStaffPreview = shopPayView && !!previewEmployeeId;
  const showShopUi = shopPayView && !isStaffPreview;
  const uiIsOwner = realIsOwner && !isStaffPreview;
  const uiCanPay = realCanPay && !isStaffPreview;
  const isOwner = uiIsOwner;
  const canPay = uiCanPay;
  const { year, month: monthIdx } = parseMonthInput(month);

  useBodyScrollLock(!!editTarget);

  useEffect(() => {
    if (staff && !canView) router.replace("/ledger/");
  }, [staff, router, canView]);

  useEffect(() => {
    if (!canView) return;
    setLoading(true);
    let cancelled = false;
    void (async () => {
      try {
        if (shopPayView) {
          try {
            await migrateAllLegacyEmployeePay();
          } catch {
            /* migrate best-effort — ไม่บล็อกหน้า */
          }
          try {
            await migrateAllBonusCloseSideDocs();
          } catch {
            /* best-effort */
          }
        }
        const [emps, otSettings] = await Promise.all([
          shopPayView ? listActiveEmployeesWithPay() : listActiveEmployees(),
          getOtSettings(),
        ]);
        if (cancelled) return;
        let nextEmps = emps;
        if (!shopPayView) {
          const linked = resolveLinkedEmployee(emps, staff);
          const payId = staff?.employeeId || linked?.id;
          if (payId) {
            try {
              const self = await getEmployeeWithPay(payId);
              if (self) {
                nextEmps = emps.map((e) => (e.id === self.id ? self : e));
                if (!nextEmps.some((e) => e.id === self.id)) nextEmps = [...nextEmps, self];
              }
            } catch {
              /* own pay optional until linked */
            }
          }
        }
        setEmployees(nextEmps);
        setOtSettingsRate(otSettings.bonusRate);
      } catch (err) {
        if (!cancelled) setError((err as Error).message || "โหลดพนักงานไม่สำเร็จ");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const unsubSettings = subscribeBonusDeductionSettings(
      (settings) => setDeductionSettings(settings),
      (err) => setError(err.message),
    );
    const unsubSchedule = subscribeRateSchedule(
      (doc) => setRateSchedule(doc.entries),
      (err) => setError(err.message),
    );
    const unsubPayrollSchedule = subscribePayrollSchedule(
      (doc) => setPayrollSchedule(doc),
      (err) => setError(err.message),
    );
    const unsubPool = !shopPayView
      ? subscribeBonusLivePool(month, setLivePool, (err) => setError(err.message))
      : () => undefined;
    return () => {
      cancelled = true;
      unsubSettings();
      unsubSchedule();
      unsubPayrollSchedule();
      unsubPool();
    };
  }, [staff, canView, shopPayView, year, monthIdx, month]);

  // OT / ผลิต — ทั้งร้านหรือเฉพาะ workerId ของตัวเอง
  useEffect(() => {
    if (!canView) return;
    const monthSince = new Date(year, monthIdx, 1).getTime();
    const monthUntil = new Date(year, monthIdx + 1, 1).getTime();
    if (shopPayView) {
      const unsubOt = subscribeOtEntries(
        (rows) => setOtEntries(rows),
        (err) => setError(err.message),
        { since: monthSince, until: monthUntil },
      );
      const unsubProd = subscribeProdEntries(
        (rows) => setProdEntries(rows),
        (err) => setError(err.message),
        { since: monthSince, until: monthUntil },
      );
      return () => {
        unsubOt();
        unsubProd();
      };
    }
    const selfId =
      staff?.employeeId || resolveLinkedEmployee(employees, staff)?.id || "";
    if (!selfId) {
      setOtEntries([]);
      setProdEntries([]);
      return;
    }
    const unsubOt = subscribeOtEntries(
      (rows) => setOtEntries(rows),
      (err) => setError(err.message),
      { since: monthSince, until: monthUntil, workerId: selfId },
    );
    const unsubProd = subscribeProdEntries(
      (rows) => setProdEntries(rows),
      (err) => setError(err.message),
      { since: monthSince, until: monthUntil, workerId: selfId },
    );
    return () => {
      unsubOt();
      unsubProd();
    };
  }, [canView, shopPayView, year, monthIdx, staff, employees]);

  // คิวจ่าย — ทั้งร้านหรือเฉพาะตัวเอง (rules บังคับกรอง employeeId)
  useEffect(() => {
    if (!canView) return;
    const payrollSince = new Date(year, monthIdx - 13, 1).getTime();
    if (shopPayView) {
      // Best-effort: แถวที่มีบช./สลิปแล้วแต่สถานะยัง pending → ปิดคิว
      void repairStuckPaidPayrollItems().catch(() => {});
      return subscribePayrollItems(
        (rows) => setPayrollItems(rows),
        (err) => setError(err.message),
        { since: payrollSince },
      );
    }
    const selfId =
      staff?.employeeId ||
      resolveLinkedEmployee(employees, staff)?.id ||
      "";
    if (!selfId) {
      setPayrollItems([]);
      return;
    }
    return subscribePayrollItems(
      (rows) => setPayrollItems(rows),
      (err) => setError(err.message),
      { since: payrollSince, employeeId: selfId },
    );
  }, [canView, shopPayView, year, monthIdx, staff, employees]);

  useEffect(() => {
    if (!canView) return;
    const unsubMonth = subscribeBonusDeductionMonth(
      year,
      monthIdx,
      (doc) => setDeductionMonth(doc),
      (err) => setError(err.message),
    );
    return () => unsubMonth();
  }, [canView, year, monthIdx]);

  // เจ้าของ/คนจ่าย: snapshot ทั้งร้าน · พนักงาน: สถานะปิดเดือน + แถวของตัวเองเท่านั้น
  useEffect(() => {
    if (!canView) return;
    if (shopPayView) {
      setMonthStatus(null);
      setPersonalClose(null);
      return subscribeBonusMonthClose(
        month,
        (doc) => setMonthClose(doc),
        (err) => setError(err.message),
      );
    }
    setMonthClose(null);
    const unsubStatus = subscribeBonusMonthStatus(
      month,
      (doc) => setMonthStatus(doc),
      (err) => setError(err.message),
    );
    return () => unsubStatus();
  }, [canView, shopPayView, month]);

  useEffect(() => {
    if (!canView || shopPayView) return;
    const empId = staff?.employeeId || resolveLinkedEmployee(employees, staff)?.id || "";
    if (!empId) {
      setPersonalClose(null);
      return;
    }
    return subscribeBonusPersonalClose(
      month,
      empId,
      (doc) => setPersonalClose(doc),
      (err) => setError(err.message),
    );
  }, [canView, shopPayView, month, staff, employees]);

  const liveReport = useMemo(() => {
    if (!shopPayView) return null;
    if (!deductionSettings || !deductionMonth) return null;
    return computeMonthBonus(
      otEntries,
      prodEntries,
      employees,
      year,
      monthIdx,
      deductionSettings.rules,
      deductionMonth.counts,
      rateSchedule,
    );
  }, [
    shopPayView,
    otEntries,
    prodEntries,
    employees,
    deductionSettings,
    deductionMonth,
    year,
    monthIdx,
    rateSchedule,
  ]);

  // เจ้าของ/คนจ่าย — เผยพูลให้พนักงานอ่านส่วนแบ่งขายได้โดยไม่เห็น OT ทั้งร้าน
  useEffect(() => {
    if (!shopPayView || !liveReport || monthClose?.status === "closed") return;
    void saveBonusLivePool(month, {
      totalSalesPool: liveReport.totalSalesPool,
      totalProdQty: liveReport.totalProdQty,
      employeeCount: liveReport.employeeCount,
      shopDeductPct: liveReport.shopDeductPct,
    }).catch(() => undefined);
  }, [shopPayView, liveReport, month, monthClose?.status]);

  /** Closed month shows frozen snapshot; open month uses live calc. */
  const report = useMemo(() => {
    if (shopPayView && monthClose?.status === "closed") {
      return reportFromCloseSnapshot(monthClose);
    }
    return liveReport;
  }, [shopPayView, monthClose, liveReport]);

  const monthClosed = shopPayView
    ? monthClose?.status === "closed"
    : monthStatus?.status === "closed" || personalClose?.status === "closed";

  const myEmployee = useMemo(
    () => resolveLinkedEmployee(employees, staff),
    [employees, staff],
  );

  const previewEmployee = useMemo(() => {
    if (!previewEmployeeId) return null;
    return employees.find((e) => e.id === previewEmployeeId) || null;
  }, [employees, previewEmployeeId]);

  const viewEmployee = isStaffPreview ? previewEmployee : myEmployee;

  // พนักงาน: เดือนปิด → แถวจาก bonusPersonalCloses · เดือนเปิด → OT/ผลิตตัวเอง + livePool
  const personalRow = useMemo((): WorkerMonthBonus | null => {
    if (shopPayView || !myEmployee) return null;
    if (personalClose?.status === "closed") {
      return workerRowFromPersonalClose(personalClose);
    }
    if (monthClosed) {
      // ปิดแล้วแต่ยังไม่มี personal doc (รอ migrate) — ไม่โชว์ยอดคนอื่น
      return null;
    }
    const shopDeductPct =
      livePool?.shopDeductPct ??
      (deductionSettings && deductionMonth
        ? computeShopDeductPct(deductionMonth.counts, deductionSettings.rules)
        : 0);
    return computePersonalBonusRow({
      otEntries,
      prodEntries,
      employee: myEmployee,
      year,
      month: monthIdx,
      shopDeductPct,
      totalSalesPool: livePool?.totalSalesPool ?? 0,
      employeeCount: livePool?.employeeCount ?? 0,
    });
  }, [
    shopPayView,
    myEmployee,
    personalClose,
    monthClosed,
    livePool,
    deductionSettings,
    deductionMonth,
    otEntries,
    prodEntries,
    year,
    monthIdx,
  ]);

  // ให้ staff.employeeId ตรงกับชื่อที่ลิงก์ — ห้ามเขียนตอนพรีวิว (จะไปทับบัญชีเจ้าของ)
  useEffect(() => {
    if (isPermPreview) return;
    if (!staff || staff.role === "owner" || !myEmployee) return;
    if (staff.employeeId === myEmployee.id) return;
    void updateStaffProfile(staff.id, {
      employeeId: myEmployee.id,
      displayName: myEmployee.name,
      profileComplete: true,
    }).catch(() => undefined);
  }, [staff, myEmployee, isPermPreview]);

  useEffect(() => {
    if (previewEmployeeId) {
      setHistoryEmployeeId(previewEmployeeId);
      return;
    }
    if (historyEmployeeId) return;
    if (myEmployee?.id) {
      setHistoryEmployeeId(myEmployee.id);
      return;
    }
    const first = employees.find((e) => e.active);
    if (first) setHistoryEmployeeId(first.id);
  }, [myEmployee?.id, employees, historyEmployeeId, previewEmployeeId]);

  const myRow = useMemo(() => {
    if (!shopPayView) return personalRow;
    if (!report) return null;
    if (isStaffPreview) {
      if (!previewEmployee) return null;
      const byId = report.rows.find((r) => r.workerId === previewEmployee.id);
      if (byId) return byId;
      return (
        report.rows.find((r) => namesMatch(r.workerName, previewEmployee.name)) ||
        null
      );
    }
    if (myEmployee) {
      const byId = report.rows.find((r) => r.workerId === myEmployee.id);
      if (byId) return byId;
      return report.rows.find((r) => namesMatch(r.workerName, myEmployee.name)) || null;
    }
    return pickMyBonusRow(
      report,
      employees,
      staff?.displayName,
      staff?.employeeId,
    );
  }, [
    shopPayView,
    isStaffPreview,
    personalRow,
    report,
    employees,
    staff?.displayName,
    staff?.employeeId,
    myEmployee,
    previewEmployee,
  ]);

  const bonusByEmployee = useMemo(() => {
    const map: Record<string, number> = {};
    if (!report) return map;
    for (const row of report.rows) {
      if (row.workerId) map[row.workerId] = row.remaining;
    }
    return map;
  }, [report]);

  /**
   * พนักงานไม่มี liveReport ทั้งร้าน — สร้างสรุปกติกาหักจาก settings+เดือน
   * เพื่อโชว์ตารางหัก + หลักฐานระวัง/ตัด หลังปิดเดือน
   */
  const staffRulesReport = useMemo((): MonthBonusReport | null => {
    if (shopPayView || !deductionSettings || !deductionMonth) return null;
    const deductionLines = buildBonusDeductionLines(
      deductionMonth.counts,
      deductionSettings.rules,
    );
    const shopDeductPct = computeShopDeductPct(
      deductionMonth.counts,
      deductionSettings.rules,
    );
    return {
      year,
      month: monthIdx,
      employeeCount: 0,
      totalProdQty: 0,
      totalSalesPool: 0,
      shopDeductPct,
      deductionLines,
      totalDeducted: 0,
      totalRemaining: 0,
      rows: [],
    };
  }, [shopPayView, deductionSettings, deductionMonth, year, monthIdx]);

  const rulesReport = report || staffRulesReport;

  async function onCloseMonth() {
    if (!uiIsOwner || !actorId || !liveReport || monthClosed) return;
    if (
      !window.confirm(
        `ปิดเดือน ${month}?\nจะล็อกตารางชง+ผลิตทั้งเดือน และเก็บยอดโบนัสคงที่ — แล้วไปสร้างคิวโบนัสที่แท็บรอโอน`,
      )
    ) {
      return;
    }
    setCloseBusy(true);
    setError(null);
    try {
      const closed = await closeBonusMonth({
        periodMonth: month,
        closedBy: actorId,
        report: liveReport,
        prodEntries,
        otEntries,
      });
      setInfo(
        `ปิดเดือน ${month} แล้ว · ล็อกผลิต ${closed.lockedProd} · ชง ${closed.lockedOt} · ไปแท็บรอโอนเพื่อสร้างโบนัส`,
      );
      setTab("pay");
    } catch (err) {
      setError((err as Error).message || "ปิดเดือนไม่สำเร็จ");
    } finally {
      setCloseBusy(false);
    }
  }

  async function onUnlockMonth() {
    if (!uiIsOwner || !monthClosed) return;
    if (!window.confirm(`ปลดปิดเดือน ${month}? แถวที่จ่ายแล้ว/ล็อกยอดยังแก้ไม่ได้`)) return;
    setCloseBusy(true);
    setError(null);
    try {
      await unlockBonusMonth(month);
      setInfo(`ปลดปิดเดือน ${month} แล้ว`);
    } catch (err) {
      setError((err as Error).message || "ปลดปิดไม่สำเร็จ");
    } finally {
      setCloseBusy(false);
    }
  }

  const visiblePayrollItems = useMemo(() => {
    if (showShopUi) return payrollItems;
    const empId = isStaffPreview
      ? previewEmployeeId
      : myEmployee?.id || "";
    if (!empId) return [];
    return payrollItems.filter((i) => i.employeeId === empId);
  }, [
    payrollItems,
    showShopUi,
    isStaffPreview,
    previewEmployeeId,
    myEmployee,
  ]);

  /** ตัวเลขแท็บรอโอน = คิวของเดือนที่เลือก ไม่รวมเดือนอื่น */
  const pendingCount = useMemo(
    () =>
      visiblePayrollItems.filter(
        (i) => i.status === "pending" && i.periodMonth === month,
      ).length,
    [visiblePayrollItems, month],
  );

  const otherMonthPendingCount = useMemo(
    () =>
      visiblePayrollItems.filter(
        (i) => i.status === "pending" && i.periodMonth !== month,
      ).length,
    [visiblePayrollItems, month],
  );

  if (!canView) return null;

  return (
    <div className="module-page bonus-page">
      <div className="module-page-head">
        <h1 className="panel-title module-page-title">
          <CircleDollarSign size={18} aria-hidden />
          จ่าย / โบนัส
        </h1>
      </div>

      {shopPayView && !isStaffPreview ? (
        <p className="muted payroll-staff-preview-hint" style={{ margin: "0 0 0.55rem", fontSize: "0.78rem" }}>
          ดูมุมพนักงาน: แตะไอคอนชื่อมุมขวาบน → ดูในมุมพนักงานคนนี้ · แตะไอคอนเขียวซ้ำเพื่อออก
        </p>
      ) : null}

      <div className="payroll-tabs" role="tablist" aria-label="จ่ายและโบนัส">
        <button
          type="button"
          role="tab"
          className={tab === "bonus" ? "is-active" : ""}
          aria-selected={tab === "bonus"}
          onClick={() => setTab("bonus")}
        >
          สรุปโบนัส
        </button>
        <button
          type="button"
          role="tab"
          className={tab === "pay" ? "is-active" : ""}
          aria-selected={tab === "pay"}
          onClick={() => setTab("pay")}
        >
          รอโอน{pendingCount ? ` (${pendingCount})` : ""}
        </button>
        <button
          type="button"
          role="tab"
          className={tab === "history" ? "is-active" : ""}
          aria-selected={tab === "history"}
          onClick={() => setTab("history")}
        >
          ประวัติ
        </button>
        <button
          type="button"
          role="tab"
          className={tab === "settings" ? "is-active" : ""}
          aria-selected={tab === "settings"}
          onClick={() => setTab("settings")}
        >
          {uiIsOwner ? "ตั้งค่าจ่าย" : "เงินเดือนฉัน"}
        </button>
      </div>

      {tab === "bonus" || tab === "pay" ? (
        <div className="bonus-toolbar">
          <input
            type="month"
            className="ot-slim-input"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            aria-label="เดือนอ้างอิง"
          />
          <span className="bonus-toolbar-meta muted">
            {showShopUi && report
              ? `${thaiMonthYearLabel(report.year, report.month)} · หารขาย ${report.employeeCount} คน`
              : report
                ? thaiMonthYearLabel(report.year, report.month)
                : "…"}
            {monthClosed ? " · ปิดเดือนแล้ว" : ""}
            {isStaffPreview && previewEmployee
              ? ` · ดูแบบ ${previewEmployee.name}`
              : ""}
          </span>
          {uiIsOwner && tab === "bonus" ? (
            monthClosed ? (
              <button
                type="button"
                className="ghost-btn"
                disabled={closeBusy}
                onClick={() => void onUnlockMonth()}
              >
                ปลดปิดเดือน
              </button>
            ) : (
              <button
                type="button"
                className="primary-btn"
                disabled={closeBusy || !liveReport}
                onClick={() => void onCloseMonth()}
              >
                {closeBusy ? "กำลังปิด…" : "ปิดเดือนนี้"}
              </button>
            )
          ) : null}
        </div>
      ) : tab === "history" ? (
        <div className="bonus-toolbar">
          <input
            type="month"
            className="ot-slim-input"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            aria-label="เดือนอ้างอิงช่วงประวัติ"
          />
          <span className="bonus-toolbar-meta muted">
            โหลดย้อนหลัง ~14 เดือนจากเดือนที่เลือก · แยกตามงวดงาน
            {isStaffPreview && previewEmployee
              ? ` · มุม ${previewEmployee.name}`
              : ""}
          </span>
        </div>
      ) : (
        <p className="muted bonus-toolbar-meta" style={{ margin: "0.25rem 0 0.65rem" }}>
          {uiIsOwner
            ? "ตั้งเงินเดือนและรอบจ่ายที่นี่ · ไม่ต้องไปหน้าอื่น"
            : "ดูเงินเดือนและรอบจ่ายของตัวเอง · ไม่เห็นยอดคนอื่น"}
        </p>
      )}

      {error ? <p className="error-text">{error}</p> : null}
      {info ? <p className="success-text">{info}</p> : null}

      {showShopUi &&
      (tab === "pay" || tab === "bonus") &&
      pendingCount === 0 &&
      otherMonthPendingCount > 0 ? (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950" style={{ marginBottom: "0.65rem" }}>
          เดือนนี้เคลียร์แล้ว แต่ยังมีค้างจ่ายอีก {otherMonthPendingCount} รายการในเดือนอื่น
          — ลองเปลี่ยนเดือนด้านบน (เช่น เดือนก่อน) เพื่อตรวจ / จ่ายให้ครบ
        </div>
      ) : null}

      {tab === "pay" ? (
        loading || (showShopUi && !report) ? (
          <p className="empty">กำลังโหลด...</p>
        ) : (
          <PayrollPayPanel
            isOwner={uiIsOwner}
            shopView={showShopUi}
            actorId={actorId}
            periodMonth={month}
            employees={employees}
            schedule={payrollSchedule}
            items={visiblePayrollItems}
            bonusByEmployee={bonusByEmployee}
            prodEntries={prodEntries}
            otEntries={otEntries}
            canPay={uiCanPay}
            bonusExplain={
              myRow
                ? {
                    total: myRow.total,
                    deductAmount: myRow.deductAmount,
                    deductPct: myRow.deductPct,
                    remaining: myRow.remaining,
                  }
                : null
            }
            onOpenBonusMonth={(periodMonth) => {
              setMonth(periodMonth);
              setTab("bonus");
            }}
            onOpenHistory={(periodMonth) => {
              setMonth(periodMonth);
              setTab("history");
            }}
            onError={setError}
            onEmployeesChange={setEmployees}
            onInfo={(msg) => {
              setInfo(msg);
              setError(null);
            }}
          />
        )
      ) : null}

      {tab === "settings" ? (
        <PayrollSettingsPanel
          schedule={payrollSchedule}
          employees={employees}
          isOwner={uiIsOwner}
          selfEmployeeId={viewEmployee?.id ?? null}
          onEmployeesChange={setEmployees}
          onError={setError}
          onInfo={(msg) => {
            setInfo(msg);
            setError(null);
          }}
        />
      ) : null}

      {tab === "history" ? (
        <PayrollHistoryPanel
          isOwner={uiIsOwner}
          shopView={showShopUi}
          employeeId={
            isStaffPreview
              ? previewEmployeeId || ""
              : showShopUi
                ? historyEmployeeId
                : myEmployee?.id || historyEmployeeId
          }
          employees={employees}
          items={
            showShopUi
              ? payrollItems
              : visiblePayrollItems
          }
          historySinceLabel={(() => {
            const since = new Date(year, monthIdx - 13, 1);
            const y = since.getFullYear();
            const m = String(since.getMonth() + 1).padStart(2, "0");
            return `ตั้งแต่ ${y}-${m}`;
          })()}
          onEmployeeIdChange={
            showShopUi && uiIsOwner
              ? setHistoryEmployeeId
              : undefined
          }
        />
      ) : null}

      {tab === "bonus" ? (
        <>
          {loading || (showShopUi && !report) ? <p className="empty">กำลังโหลด...</p> : null}

          {/* สรุปพูลทั้งร้าน + ตารางรายคน: มุมร้านเท่านั้น — พนักงาน/พรีวิวเห็นแค่ของฉัน */}
          {report && showShopUi ? (
            <div className="bonus-summary-bar">
              <div className="bonus-summary-pool">
                <span className="bonus-summary-label">โบนัสขายเบเกอรี่ รวม</span>
                <strong className="bonus-summary-pool-amt">฿{fmt(report.totalSalesPool)}</strong>
                <span className="muted bonus-summary-pool-meta">
                  จากผลิต {fmt(report.totalProdQty)} ชิ้น × เรทขายตามวัน (ตารางเรท)
                  {monthClosed && monthClose
                    ? ` · ปิด ${formatDateShortBe(monthClose.closedAt)}`
                    : ""}
                </span>
              </div>
              <div className="bonus-summary-total">
                <span className="bonus-summary-label">คงเหลือรวม</span>
                <strong>฿{fmt(report.totalRemaining)}</strong>
              </div>
            </div>
          ) : null}

          {monthClosed && showShopUi ? (
            <p className="muted bonus-live-note">
              เดือนนี้ปิดแล้ว — ชง/ผลิตล็อกห้ามลงย้อนหลัง · ยอดด้านบนเป็น snapshot · สร้างโบนัสที่แท็บรอโอน
            </p>
          ) : null}

          {monthClosed && !showShopUi ? (
            <p className="muted bonus-live-note">
              เดือนนี้ปิดแล้ว — แสดงเฉพาะยอดโบนัสของฉันที่ล็อกไว้ตอนปิดเดือน
            </p>
          ) : null}

          {!loading && myRow ? (
            <section className="bonus-my-card">
              <header className="bonus-my-head">
                <div>
                  <span className="bonus-my-label">ของฉัน</span>
                  <h2 className="bonus-my-name">{myRow.workerName}</h2>
                </div>
                <p className="bonus-my-total">฿{fmt(myRow.remaining)}</p>
              </header>
              <dl className="bonus-my-grid">
                <div>
                  <dt>ขายเบเกอรี่</dt>
                  <dd>฿{fmt(myRow.salesShare)}</dd>
                </div>
                <div>
                  <dt>ผลิตเบเกอรี่</dt>
                  <dd>฿{fmt(myRow.prodBonus)}</dd>
                </div>
                <div>
                  <dt>โบนัสชง</dt>
                  <dd>฿{fmt(myRow.otMain)}</dd>
                </div>
                <div>
                  <dt>รวม</dt>
                  <dd>฿{fmt(myRow.total)}</dd>
                </div>
                <div>
                  <dt>หักโบนัส ({fmtPct(myRow.deductPct)})</dt>
                  <dd className="bonus-my-deduct">−฿{fmt(myRow.deductAmount)}</dd>
                </div>
              </dl>
              <p className="muted bonus-live-note">
                หักตามกติการ้าน · อัปเดตเมื่อมีการกรอกชง / ผลิต · ไม่แสดงยอดคนอื่น
                {!showShopUi && !isStaffPreview && !livePool && !monthClosed
                  ? " · ส่วนแบ่งขายจะครบเมื่อเจ้าของเปิดหน้านี้ในเดือนนี้"
                  : ""}
              </p>
            </section>
          ) : null}

          {!loading && !myRow && !showShopUi ? (
            <p className="muted bonus-no-match">
              {isStaffPreview && previewEmployee ? (
                <>
                  ไม่พบแถวโบนัสของ &quot;{previewEmployee.name}&quot; ในเดือนนี้ — อาจยังไม่ปิดเดือน
                  หรือไม่มีชื่อในสรุปโบนัส
                </>
              ) : monthClosed && myEmployee ? (
                <>
                  เดือนนี้ปิดแล้ว แต่ยังไม่มีแถวโบนัสของฉัน — ให้เจ้าของร้านเข้าแอปครั้งหนึ่งเพื่อ migrate
                  ข้อมูลปิดเดือน
                </>
              ) : staff?.displayName ? (
                <>
                  ไม่พบชื่อ &quot;{staff.displayName}&quot; ในรายชื่อพนักงาน — ตรวจที่{" "}
                  <a href="/staff/" style={{ fontWeight: 700 }}>
                    ศูนย์รวมพนักงาน
                  </a>{" "}
                  หรือโปรไฟล์ เพื่อเห็นโบนัสของตัวเอง
                </>
              ) : (
                <>
                  ยังไม่ได้เชื่อมชื่อกับรายชื่อร้าน — ไปที่{" "}
                  <a href="/staff/" style={{ fontWeight: 700 }}>
                    ศูนย์รวมพนักงาน
                  </a>{" "}
                  หรือโปรไฟล์ เพื่อเห็นโบนัสของตัวเอง
                </>
              )}
            </p>
          ) : null}

          {!loading && report && showShopUi ? (
            <BonusTable report={report} highlightName={myRow?.workerName} />
          ) : null}

          {report && showShopUi ? (
            <p className="muted bonus-footnote">
              ขาย = จำนวนผลิต × เรทขายจากตารางเรท (ตามวันผลิต) แล้วหารคนที่ลงทะเบียนทำงานในเดือน
              (ผลิตหรือชง) — มีชื่ออย่างเดียวไม่หาร · ผลิต/ชง จากยอดจริง · เจ้าของกรอกจำนวนหักทั้งร้านสิ้นเดือน ·
              เรท% ถาวร
            </p>
          ) : null}

          {rulesReport ? (
            <BonusDeductionSummaryTable
              report={rulesReport}
              isOwner={uiIsOwner}
              onEditRate={(rule) => setEditTarget({ kind: "rate", rule })}
              onEditQty={(rule, qty) => setEditTarget({ kind: "qty", rule, qty })}
            />
          ) : null}

          {/* พนักงานต้องเห็นหลักฐานระวัง/ตัด แม้ไม่มี report ทั้งร้าน */}
          {rulesReport || !showShopUi ? (
            <BonusDeductionEvidencePanel
              year={year}
              month={monthIdx}
              periodMonth={month}
              doc={deductionMonth}
              isOwner={uiIsOwner}
              actorId={actorId || ""}
              onError={setError}
              onInfo={(msg) => {
                setInfo(msg);
                setError(null);
              }}
              onSaved={(next) => setDeductionMonth(next)}
            />
          ) : null}

          <RateSchedulePanel
            isOwner={uiIsOwner}
            actorId={actorId}
            otSettingsFallback={otSettingsRate}
            onError={setError}
          />
        </>
      ) : null}

      {editTarget ? (
        <BonusEditModal
          target={editTarget}
          onClose={() => setEditTarget(null)}
          onError={setError}
          year={year}
          month={monthIdx}
        />
      ) : null}
    </div>
  );
}

function BonusDeductionSummaryTable({
  report,
  isOwner,
  onEditRate,
  onEditQty,
}: {
  report: MonthBonusReport;
  isOwner: boolean;
  onEditRate: (rule: BonusDeductionRule) => void;
  onEditQty: (rule: BonusDeductionRule, qty: number) => void;
}) {
  const lines = report.deductionLines;

  return (
    <div className="sheet-wrap bonus-deduct-wrap sheet-bleed">
      <table className="sheet-table bonus-deduct-table sheet-table--dense">
        <thead>
          <tr>
            <th>รายการ</th>
            <th className="col-out">จำนวน</th>
            <th className="col-out">เรท%</th>
            <th className="col-out bonus-th-line-pct">รวม%</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id}>
              <td>{line.label}</td>
              <td className="col-out">
                {isOwner ? (
                  <button
                    type="button"
                    className="bonus-edit-cell"
                    onClick={() =>
                      onEditQty(
                        { id: line.id, label: line.label, pctPerUnit: line.ratePct },
                        line.qty,
                      )
                    }
                    title="แตะเพื่อแก้จำนวน (เดือนนี้)"
                  >
                    {line.qty}
                  </button>
                ) : (
                  line.qty
                )}
              </td>
              <td className="col-out">
                {isOwner ? (
                  <button
                    type="button"
                    className="bonus-edit-cell"
                    onClick={() =>
                      onEditRate({ id: line.id, label: line.label, pctPerUnit: line.ratePct })
                    }
                    title="แตะเพื่อแก้เรท% (ถาวร)"
                  >
                    {fmtPct(line.ratePct)}
                  </button>
                ) : (
                  fmtPct(line.ratePct)
                )}
              </td>
              <td className="col-out bonus-th-line-pct">{fmtPct(line.linePct)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bonus-deduct-foot-row">
            <td colSpan={3}>หักโบนัสรวม</td>
            <td className="col-out bonus-th-line-pct">
              <strong>{fmtPct(report.shopDeductPct)}</strong>
            </td>
          </tr>
        </tfoot>
      </table>
      <p className="muted bonus-deduct-note">
        {isOwner
          ? "กรอกจำนวนสิ้นเดือน · แตะเรท% แก้ถาวร · รวม% นำไปหักทุกคน · หลักฐานแนบด้านล่าง"
          : "กติกาหักโบนัสทั้งร้าน · ดูหลักฐานงวดได้ด้านล่าง — ไม่แสดงยอดรายคน"}
      </p>
    </div>
  );
}

function BonusTable({
  report,
  highlightName,
}: {
  report: MonthBonusReport;
  highlightName?: string;
}) {
  if (!report.rows.length) {
    return <p className="empty">ยังไม่มีข้อมูลโบนัสในเดือนนี้</p>;
  }

  return (
    <div className="sheet-wrap bonus-sheet-wrap sheet-bleed">
      <table className="sheet-table bonus-table sheet-table--dense">
        <thead>
          <tr>
            <th className="bonus-th-name">ชื่อ</th>
            <th className="col-out">ขาย</th>
            <th className="col-out">ผลิต</th>
            <th className="col-out">ชง</th>
            <th className="col-out">รวม</th>
            <th className="col-out bonus-th-deduct">หักโบนัส</th>
            <th className="col-out bonus-th-final">คงเหลือ</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row) => {
            const mine = highlightName && row.workerName === highlightName;
            return (
              <tr key={row.workerId + row.workerName} className={mine ? "bonus-row-mine" : ""}>
                <td className="bonus-th-name">{row.workerName}</td>
                <td className="col-out">{fmt(row.salesShare)}</td>
                <td className="col-out">{fmt(row.prodBonus)}</td>
                <td className="col-out">{fmt(row.otMain)}</td>
                <td className="col-out">{fmt(row.total)}</td>
                <td className="col-out bonus-th-deduct">
                  {row.deductAmount > 0 ? (
                    <>
                      <span className="bonus-deduct-pct">{fmtPct(row.deductPct)}</span>
                      <span className="bonus-deduct-amt">−{fmt(row.deductAmount)}</span>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="col-out bonus-th-final">
                  <strong>฿{fmt(row.remaining)}</strong>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bonus-foot-row">
            <td colSpan={5}>รวมทั้งร้าน</td>
            <td className="col-out bonus-th-deduct">−{fmt(report.totalDeducted)}</td>
            <td className="col-out bonus-th-final">
              <strong>฿{fmt(report.totalRemaining)}</strong>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function BonusEditModal({
  target,
  onClose,
  onError,
  year,
  month,
}: {
  target: EditTarget;
  onClose: () => void;
  onError: (msg: string) => void;
  year: number;
  month: number;
}) {
  const [busy, setBusy] = useState(false);
  const [value, setValue] = useState(
    target.kind === "rate" ? String(target.rule.pctPerUnit) : String(target.qty),
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (target.kind === "rate") {
        await saveBonusDeductionRulePct(target.rule.id as BonusDeductionRuleId, Number(value));
      } else {
        await saveBonusDeductionMonthQty(year, month, target.rule.id as BonusDeductionRuleId, Number(value));
      }
      onClose();
    } catch (err) {
      onError((err as Error).message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  const title =
    target.kind === "rate"
      ? `เรท% — ${target.rule.label}`
      : `จำนวน — ${target.rule.label}`;

  return (
    <div className="modal-backdrop edit-modal is-module-form" onClick={onClose}>
      <form
        className="modal-card module-form-card"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void onSubmit(e)}
      >
        <h2 className="panel-title" style={{ fontSize: "1rem", marginBottom: "0.65rem" }}>
          {title}
        </h2>

        <div className="field">
          <label htmlFor="bonus-edit-value">
            {target.kind === "rate" ? "เรท % ต่อหน่วย" : "จำนวน (ทั้งร้าน เดือนนี้)"}
          </label>
          <input
            id="bonus-edit-value"
            type="number"
            min="0"
            step={target.kind === "rate" ? "0.01" : "1"}
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
            autoFocus
          />
          <p className="muted form-hint-inline">
            {target.kind === "rate" ? "เรทถาวร — ใช้ทุกเดือน" : "กรอกตอนจ่ายโบนัสสิ้นเดือน"}
          </p>
        </div>

        <div className="module-form-actions">
          <button type="button" className="ghost-btn" onClick={onClose} disabled={busy}>
            ยกเลิก
          </button>
          <button type="submit" className="primary-btn" disabled={busy}>
            {busy ? "กำลังบันทึก..." : "บันทึก"}
          </button>
        </div>
      </form>
    </div>
  );
}
