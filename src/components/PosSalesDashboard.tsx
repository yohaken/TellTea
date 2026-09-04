"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import {
  averagePerBill,
  averagePerDay,
  averagePerUnit,
  averageUnitsPerBill,
  countSaleUnits,
  posRangeUntilExclusiveMs,
  summarizeMemberGrowth,
  summarizeMemberSalesTouch,
  summarizePosSalesByDay,
  summarizePosSalesByHour,
  summarizePosSalesByWeekday,
  summarizePosSalesProducts,
  summarizeStockMovementsForDashboard,
} from "@/lib/pos-sales-dashboard";
import {
  subscribeMembersCreatedThrough,
  type ShopMember,
} from "@/lib/members";
import {
  clampPosDateRange,
  defaultPosDashboardRange,
  formatPosDateRangeLabel,
  listPosDashboardMonthOptions,
  POS_DASHBOARD_MAX_RANGE_DAYS,
  normalizePosDateRange,
  posDashboardMonthRange,
  posDateRangeDayCount,
  posDateRangeDayCountRaw,
  posRangeDayInputValue,
  posRangeMatchedMonthKey,
  shiftPosMonthKey,
  subscribePosSalesForDateRange,
  summarizePosSalesDetailed,
  type PosDateRange,
} from "@/lib/pos-sales-report";
import { bangkokMonthKey } from "@/lib/vat-sales";
import { subscribeMenuCategories, subscribeMenuItems } from "@/lib/pos-menu";
import { subscribeStockMovements } from "@/lib/stock";
import type { MenuCategory, MenuItem, PosSale, StockMovement } from "@/lib/types";
import {
  formatPlainNumber,
  formatStockQty,
  parseDateInput,
  startOfLocalDay,
  addLocalDays,
} from "@/lib/utils";
import { PosOpsCorrelationChart } from "@/components/PosOpsCorrelationChart";
import {
  PosDashDailyAreaChart,
  PosDashDailyTotalsTable,
  PosDashHourBarChart,
  PosDashWeekdayBarChart,
} from "@/components/PosSalesDashboardCharts";
import { PosSalesDashboardProducts } from "@/components/PosSalesDashboardProducts";
import { PosSalesDashboardStock } from "@/components/PosSalesDashboardStock";
import { PosSalesDashboardMembers } from "@/components/PosSalesDashboardMembers";
import { collection, onSnapshot } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import {
  ensurePosWeatherDays,
  type WeatherDayDoc,
} from "@/lib/pos-weather";
import { subscribeOtEntries, type OtEntry } from "@/lib/ot";
import { subscribeProdEntries, type ProdEntry } from "@/lib/production";
import { subscribeProdPolicy, DEFAULT_PROD_POLICY } from "@/lib/prod-policy";
import { summarizeOpsCorrelationByDay } from "@/lib/pos-ops-correlation";

function pct(part: number, whole: number): number {
  if (!(whole > 0) || !(part > 0)) return 0;
  return Math.round((part / whole) * 10000) / 100;
}

function tenderSegments(summary: ReturnType<typeof summarizePosSalesDetailed>) {
  const total = summary.total;
  const cash = summary.cashTotal;
  const promptpay = summary.promptpayTotal;
  const transfer = summary.transferTotal;
  const other = Math.round((promptpay + transfer) * 100) / 100;
  return {
    cash,
    cashPct: pct(cash, total),
    promptpay,
    promptpayPct: pct(promptpay, total),
    transfer,
    transferPct: pct(transfer, total),
    other,
    otherPct: pct(other, total),
  };
}

function conicFromTenders(cashPct: number, ppPct: number, transferPct: number): string {
  const c = Math.max(0, cashPct);
  const p = Math.max(0, ppPct);
  const t = Math.max(0, transferPct);
  const sum = c + p + t;
  if (sum <= 0) return "conic-gradient(#e5e7eb 0deg 360deg)";
  const cEnd = (c / sum) * 360;
  const pEnd = cEnd + (p / sum) * 360;
  return `conic-gradient(#7eb8d8 0deg ${cEnd}deg, #5bc0de ${cEnd}deg ${pEnd}deg, #f0a06a ${pEnd}deg 360deg)`;
}

export function PosSalesDashboard({
  onError,
  onOpenSessions,
}: {
  onError?: (msg: string | null) => void;
  onOpenSessions?: (opts?: { voided?: boolean }) => void;
}) {
  const router = useRouter();
  const [range, setRange] = useState<PosDateRange>(() => defaultPosDashboardRange());
  const [draftStart, setDraftStart] = useState(() => posRangeDayInputValue(range.startMs));
  const [draftEnd, setDraftEnd] = useState(() => posRangeDayInputValue(range.endMs));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sales, setSales] = useState<PosSale[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [menuCategories, setMenuCategories] = useState<MenuCategory[]>([]);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);
  const [stockCosts, setStockCosts] = useState<Map<string, number>>(() => new Map());
  const [members, setMembers] = useState<ShopMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [stockNote, setStockNote] = useState<string | null>(null);
  const [membersNote, setMembersNote] = useState<string | null>(null);
  const [weatherByDay, setWeatherByDay] = useState<Record<string, WeatherDayDoc>>({});
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [otEntries, setOtEntries] = useState<OtEntry[]>([]);
  const [prodEntries, setProdEntries] = useState<ProdEntry[]>([]);
  const [wasteBonusPct, setWasteBonusPct] = useState(DEFAULT_PROD_POLICY.wasteBonusPct);
  const [opsNote, setOpsNote] = useState<string | null>(null);

  const clamped = useMemo(() => clampPosDateRange(range), [range]);
  const dayCount = useMemo(() => posDateRangeDayCount(clamped), [clamped]);
  const rangeTooLong = dayCount > POS_DASHBOARD_MAX_RANGE_DAYS;
  const monthOptions = useMemo(() => listPosDashboardMonthOptions(Date.now(), 24), []);
  const matchedMonthKey = useMemo(() => posRangeMatchedMonthKey(clamped), [clamped]);
  const currentMonthKey = bangkokMonthKey();

  useEffect(() => {
    setDraftStart(posRangeDayInputValue(clamped.startMs));
    setDraftEnd(posRangeDayInputValue(clamped.endMs));
  }, [clamped.startMs, clamped.endMs]);

  useEffect(() => {
    if (rangeTooLong) {
      setSales([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    return subscribePosSalesForDateRange(
      clamped,
      (list) => {
        setSales(list);
        setLoading(false);
        onError?.(null);
      },
      (err) => {
        const msg = err.message || "โหลดยอดขายไม่สำเร็จ";
        // Surface a clearer hint for the common rules denial on date queries
        onError?.(
          /permission|insufficient/i.test(msg)
            ? "ไม่มีสิทธิ์อ่านยอดขายในช่วงวันที่นี้ (ต้องเป็นเจ้าของ) — ลองรีเฟรชหรือเข้าสู่ระบบใหม่"
            : msg,
        );
        setLoading(false);
      },
    );
  }, [clamped, rangeTooLong, onError]);

  useEffect(() => {
    // Menu is optional for product join — do not block the date toolbar on denial.
    const unsubItems = subscribeMenuItems(setMenuItems);
    const unsubCats = subscribeMenuCategories(setMenuCategories);
    return () => {
      unsubItems();
      unsubCats();
    };
  }, []);

  useEffect(() => {
    if (rangeTooLong) {
      setStockMovements([]);
      return;
    }
    // Clear immediately so widening/narrowing the range cannot flash stale rows.
    setStockMovements([]);
    setStockNote(null);
    // since-only query (end filtered client-side) — avoids rare composite/until denials
    // wiping the whole dashboard error line next to the date row.
    return subscribeStockMovements(
      setStockMovements,
      (err) => {
        setStockMovements([]);
        setStockNote(
          /permission|insufficient/i.test(err.message || "")
            ? "ไม่มีสิทธิ์อ่านสต็อก — การ์ดสินค้าคงคลังว่าง"
            : "โหลดสต็อกไม่สำเร็จ — การ์ดสินค้าคงคลังว่าง",
        );
      },
      { since: clamped.startMs },
    );
  }, [clamped.startMs, rangeTooLong]);

  useEffect(() => {
    return onSnapshot(
      collection(getDb(), "stockCosts"),
      (snap) => {
        setStockCosts(
          new Map(
            snap.docs.map((d) => [
              d.id,
              Math.round((Number(d.data().unitCost) || 0) * 100) / 100,
            ]),
          ),
        );
      },
      () => {
        // Costs are owner-only; dashboard still works with 0 baht stock values.
        setStockCosts(new Map());
      },
    );
  }, []);

  useEffect(() => {
    if (rangeTooLong) {
      setMembers([]);
      return;
    }
    setMembers([]);
    setMembersNote(null);
    const untilExclusive = posRangeUntilExclusiveMs(clamped);
    return subscribeMembersCreatedThrough(
      untilExclusive,
      (list) => {
        setMembers(list);
        setMembersNote(null);
      },
      (err) => {
        setMembers([]);
        setMembersNote(
          /permission|insufficient/i.test(err.message || "")
            ? "ไม่มีสิทธิ์อ่านสมาชิก — การ์ดสมาชิกว่าง"
            : "โหลดสมาชิกไม่สำเร็จ — การ์ดสมาชิกว่าง",
        );
      },
    );
  }, [clamped, rangeTooLong]);

  const summary = useMemo(() => summarizePosSalesDetailed(sales), [sales]);
  const tenders = useMemo(() => tenderSegments(summary), [summary]);
  useEffect(() => {
    return subscribeProdPolicy((p) => setWasteBonusPct(p.wasteBonusPct));
  }, []);

  useEffect(() => {
    if (rangeTooLong) {
      setOtEntries([]);
      setProdEntries([]);
      return;
    }
    setOpsNote(null);
    const until = posRangeUntilExclusiveMs(clamped);
    const unsubOt = subscribeOtEntries(
      setOtEntries,
      (err) => {
        setOtEntries([]);
        setOpsNote(
          /permission|insufficient/i.test(err.message || "")
            ? "ไม่มีสิทธิ์อ่านชง — กราฟความสัมพันธ์ใช้เฉพาะยอดขาย"
            : "โหลดชงไม่สำเร็จ",
        );
      },
      { since: clamped.startMs, until },
    );
    const unsubProd = subscribeProdEntries(
      setProdEntries,
      (err) => {
        setProdEntries([]);
        setOpsNote((prev) =>
          prev ||
          (/permission|insufficient/i.test(err.message || "")
            ? "ไม่มีสิทธิ์อ่านผลิต — กราฟความสัมพันธ์ใช้เฉพาะยอดขาย/ชง"
            : "โหลดผลิตไม่สำเร็จ"),
        );
      },
      { since: clamped.startMs, until },
    );
    return () => {
      unsubOt();
      unsubProd();
    };
  }, [clamped, rangeTooLong]);

  const byDay = useMemo(() => summarizePosSalesByDay(sales, clamped), [sales, clamped]);
  const opsPoints = useMemo(
    () =>
      summarizeOpsCorrelationByDay({
        range: clamped,
        salesByDay: byDay,
        otEntries,
        prodEntries,
        wasteBonusPct,
      }),
    [clamped, byDay, otEntries, prodEntries, wasteBonusPct],
  );
  const memberGrowth = useMemo(
    () => summarizeMemberGrowth(members, clamped),
    [members, clamped],
  );
  const memberSalesTouch = useMemo(() => summarizeMemberSalesTouch(sales), [sales]);
  // Stable key list — do not re-fetch weather on every sales snapshot tick.
  const weatherDateKeys = useMemo(
    () => byDay.map((d) => d.dateKey).join(","),
    [byDay],
  );

  useEffect(() => {
    const keys = weatherDateKeys ? weatherDateKeys.split(",") : [];
    if (!keys.length) {
      setWeatherByDay({});
      setWeatherLoading(false);
      return;
    }
    let cancelled = false;
    setWeatherLoading(true);
    ensurePosWeatherDays(keys)
      .then((map) => {
        if (!cancelled) setWeatherByDay(map);
      })
      .catch(() => {
        // Weather is optional — keep sales table usable.
      })
      .finally(() => {
        if (!cancelled) setWeatherLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [weatherDateKeys]);

  const byHour = useMemo(() => summarizePosSalesByHour(sales), [sales]);
  const byWeekday = useMemo(() => summarizePosSalesByWeekday(sales), [sales]);
  const products = useMemo(
    () => summarizePosSalesProducts(sales, menuItems, menuCategories, 10),
    [sales, menuItems, menuCategories],
  );
  const stockSummary = useMemo(
    () => summarizeStockMovementsForDashboard(stockMovements, clamped, stockCosts),
    [stockMovements, clamped, stockCosts],
  );
  const label = formatPosDateRangeLabel(clamped);
  const unitCount = useMemo(() => countSaleUnits(sales), [sales]);
  const avgBill = averagePerBill(summary.total, summary.activeCount);
  const avgDay = averagePerDay(summary.total, clamped);
  const avgUnit = averagePerUnit(summary.total, unitCount);
  const avgUnitsBill = averageUnitsPerBill(unitCount, summary.activeCount);
  const discountBillPct = pct(summary.discountCount, summary.activeCount);

  function applyDraftRange() {
    onError?.(null);
    try {
      const startMs = startOfLocalDay(parseDateInput(draftStart));
      const endMs = startOfLocalDay(parseDateInput(draftEnd));
      const next = normalizePosDateRange({ startMs, endMs });
      if (posDateRangeDayCountRaw(next) > POS_DASHBOARD_MAX_RANGE_DAYS) {
        onError?.(`เลือกได้ไม่เกิน ${POS_DASHBOARD_MAX_RANGE_DAYS} วัน`);
        return;
      }
      setRange(next);
      setPickerOpen(false);
    } catch (err) {
      onError?.((err as Error).message || "วันที่ไม่ถูกต้อง");
    }
  }

  function setPreset(
    kind: "today" | "last7" | "month" | "last3m" | "last6m" | "last1y",
  ) {
    onError?.(null);
    const today = startOfLocalDay();
    if (kind === "today") {
      setRange({ startMs: today, endMs: today });
    } else if (kind === "last7") {
      setRange(clampPosDateRange({ startMs: addLocalDays(today, -6), endMs: today }));
    } else if (kind === "month") {
      setRange(defaultPosDashboardRange());
    } else if (kind === "last3m") {
      setRange(clampPosDateRange({ startMs: addLocalDays(today, -89), endMs: today }));
    } else if (kind === "last6m") {
      setRange(clampPosDateRange({ startMs: addLocalDays(today, -182), endMs: today }));
    } else {
      setRange(clampPosDateRange({ startMs: addLocalDays(today, -364), endMs: today }));
    }
    setPickerOpen(false);
  }

  function selectMonth(monthKey: string) {
    onError?.(null);
    try {
      const newest = monthOptions[0]?.monthKey || currentMonthKey;
      const oldest = monthOptions[monthOptions.length - 1]?.monthKey || currentMonthKey;
      if (monthKey > newest || monthKey < oldest) return;
      setRange(posDashboardMonthRange(monthKey));
      setPickerOpen(false);
    } catch (err) {
      onError?.((err as Error).message || "เดือนไม่ถูกต้อง");
    }
  }

  function shiftMonth(delta: number) {
    const base = matchedMonthKey || bangkokMonthKey(clamped.startMs);
    const next = shiftPosMonthKey(base, delta);
    selectMonth(next);
  }

  const donutStyle = {
    background: conicFromTenders(tenders.cashPct, tenders.promptpayPct, tenders.transferPct),
  } as const;

  const monthSelectValue = matchedMonthKey || "";
  const canMonthPrev =
    !!monthOptions.length &&
    (matchedMonthKey || bangkokMonthKey(clamped.startMs)) > monthOptions[monthOptions.length - 1].monthKey;
  const canMonthNext =
    !!monthOptions.length &&
    (matchedMonthKey || bangkokMonthKey(clamped.startMs)) < monthOptions[0].monthKey;

  return (
    <div className="pos-dash">
      <div className="pos-dash-toolbar">
        <div className="pos-dash-month-nav" role="group" aria-label="เลือกเดือน">
          <button
            type="button"
            className="pos-dash-month-arrow"
            onClick={() => shiftMonth(-1)}
            disabled={!canMonthPrev}
            aria-label="เดือนก่อน"
          >
            <ChevronLeft size={16} aria-hidden />
          </button>
          <label className="pos-dash-month-select-wrap">
            <span className="sr-only">เดือน</span>
            <select
              className="pos-dash-month-select"
              value={monthSelectValue}
              onChange={(e) => {
                const v = e.target.value;
                if (v) selectMonth(v);
              }}
            >
              {!matchedMonthKey ? (
                <option value="">กำหนดเอง · {label}</option>
              ) : null}
              {monthOptions.map((opt) => (
                <option key={opt.monthKey} value={opt.monthKey}>
                  {opt.label}
                  {opt.monthKey === currentMonthKey ? " (เดือนนี้)" : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="pos-dash-month-arrow"
            onClick={() => shiftMonth(1)}
            disabled={!canMonthNext}
            aria-label="เดือนถัดไป"
          >
            <ChevronRight size={16} aria-hidden />
          </button>
        </div>

        <button
          type="button"
          className="pos-dash-range-btn"
          onClick={() => setPickerOpen((v) => !v)}
          aria-expanded={pickerOpen}
          aria-label="เลือกช่วงวันที่"
        >
          <Calendar size={16} strokeWidth={1.75} aria-hidden />
          <span>{label}</span>
        </button>
        <div className="pos-dash-presets" role="group" aria-label="ช่วงลัด">
          <button type="button" className="npos-slim-text-btn" onClick={() => setPreset("today")}>
            วันนี้
          </button>
          <button type="button" className="npos-slim-text-btn" onClick={() => setPreset("last7")}>
            7 วัน
          </button>
          <button type="button" className="npos-slim-text-btn" onClick={() => setPreset("month")}>
            เดือนนี้
          </button>
          <button type="button" className="npos-slim-text-btn" onClick={() => setPreset("last3m")}>
            3 เดือน
          </button>
          <button type="button" className="npos-slim-text-btn" onClick={() => setPreset("last6m")}>
            6 เดือน
          </button>
          <button type="button" className="npos-slim-text-btn" onClick={() => setPreset("last1y")}>
            1 ปี
          </button>
        </div>
      </div>

      {pickerOpen ? (
        <div className="pos-dash-range-panel">
          <label>
            <span className="muted">จาก</span>
            <input
              type="date"
              value={draftStart}
              onChange={(e) => setDraftStart(e.target.value)}
            />
          </label>
          <label>
            <span className="muted">ถึง</span>
            <input type="date" value={draftEnd} onChange={(e) => setDraftEnd(e.target.value)} />
          </label>
          <button type="button" className="npos-slim-text-btn is-active" onClick={applyDraftRange}>
            ใช้ช่วงนี้
          </button>
          <p className="muted pos-dash-range-hint">สูงสุด {POS_DASHBOARD_MAX_RANGE_DAYS} วัน</p>
        </div>
      ) : null}

      {stockNote ? <p className="muted pos-dash-stock-note">{stockNote}</p> : null}
      {membersNote ? <p className="muted pos-dash-stock-note">{membersNote}</p> : null}
      {opsNote ? <p className="muted pos-dash-stock-note">{opsNote}</p> : null}

      {rangeTooLong ? (
        <p className="error-text">ช่วงวันที่ยาวเกิน {POS_DASHBOARD_MAX_RANGE_DAYS} วัน — ย่อช่วงก่อน</p>
      ) : null}
      {loading ? <p className="empty">กำลังโหลดแดชบอร์ด...</p> : null}

      {!rangeTooLong ? <PosOpsCorrelationChart points={opsPoints} /> : null}

      {!loading && !rangeTooLong ? (
        <>
          <div className="pos-dash-top-grid">
            <article className="pos-dash-card pos-dash-card--net">
              <h3 className="pos-dash-card-title">ยอดรับเงินจริง</h3>
              <p className="pos-dash-net-value">
                {formatPlainNumber(summary.total)} <span>บาท</span>
              </p>
              <p className="muted pos-dash-footnote">
                หลังหักส่วนลดมือ + แลกแต้ม · ไม่ใช่ยอดขายบวกแต้ม
              </p>
              <div className="pos-dash-net-body">
                <div className="pos-dash-tender">
                  <div
                    className="pos-dash-tender-bar"
                    role="img"
                    aria-label={`เงินสด ${tenders.cashPct}% · อื่นๆ ${tenders.otherPct}%`}
                  >
                    <span
                      className="pos-dash-tender-seg pos-dash-tender-seg--cash"
                      style={{ width: `${tenders.cashPct}%` }}
                    />
                    <span
                      className="pos-dash-tender-seg pos-dash-tender-seg--other"
                      style={{ width: `${tenders.otherPct}%` }}
                    />
                  </div>
                  <div className="pos-dash-tender-legend">
                    <span>
                      เงินสด {tenders.cashPct.toFixed(2)}%
                      <br />
                      <strong>{formatPlainNumber(tenders.cash)} บาท</strong>
                    </span>
                    <span>
                      อื่นๆ {tenders.otherPct.toFixed(2)}%
                      <br />
                      <strong>{formatPlainNumber(tenders.other)} บาท</strong>
                      <span className="muted pos-dash-tender-sub">
                        {" "}
                        (PP {formatPlainNumber(tenders.promptpay)} · โอน{" "}
                        {formatPlainNumber(tenders.transfer)})
                      </span>
                    </span>
                  </div>
                </div>
                <dl className="pos-dash-breakdown">
                  <div>
                    <dt>ยอดขาย</dt>
                    <dd>{formatPlainNumber(summary.grossTotal)} บาท</dd>
                  </div>
                  <div>
                    <dt>ส่วนลดมือ</dt>
                    <dd>−{formatPlainNumber(summary.manualDiscountTotal)} บาท</dd>
                  </div>
                  <div>
                    <dt>แลกแต้ม (ส่วนลด)</dt>
                    <dd>−{formatPlainNumber(summary.redeemTotal)} บาท</dd>
                  </div>
                  <div className="pos-dash-breakdown--total">
                    <dt>ยอดรับเงิน</dt>
                    <dd>{formatPlainNumber(summary.total)} บาท</dd>
                  </div>
                </dl>
              </div>
            </article>

            <article className="pos-dash-card pos-dash-card--bills">
              <div className="pos-dash-card-head">
                <h3 className="pos-dash-card-title">บิลที่ปิดไปแล้ว</h3>
                <button
                  type="button"
                  className="npos-slim-text-btn pos-dash-more"
                  onClick={() => onOpenSessions?.()}
                >
                  ดูเพิ่มเติม
                </button>
              </div>
              <div className="pos-dash-bills-body">
                <div className="pos-dash-donut-wrap">
                  <div className="pos-dash-donut" style={donutStyle} aria-hidden>
                    <div className="pos-dash-donut-hole">
                      <span className="pos-dash-donut-label">ทั้งหมด</span>
                      <strong>{summary.activeCount.toLocaleString("th-TH")}</strong>
                      <span className="pos-dash-donut-label">บิล</span>
                    </div>
                  </div>
                </div>
                <ul className="pos-dash-bill-channels">
                  <li>
                    <span className="pos-dash-dot pos-dash-dot--cash" />
                    <span className="pos-dash-channel-name">เงินสด</span>
                    <span className="pos-dash-channel-count">
                      {summary.cashCount.toLocaleString("th-TH")} บิล
                    </span>
                    <span className="pos-dash-channel-amt">
                      {formatPlainNumber(summary.cashTotal)} บาท
                    </span>
                  </li>
                  <li>
                    <span className="pos-dash-dot pos-dash-dot--pp" />
                    <span className="pos-dash-channel-name">PromptPay</span>
                    <span className="pos-dash-channel-count">
                      {summary.promptpayCount.toLocaleString("th-TH")} บิล
                    </span>
                    <span className="pos-dash-channel-amt">
                      {formatPlainNumber(summary.promptpayTotal)} บาท
                    </span>
                  </li>
                  <li>
                    <span className="pos-dash-dot pos-dash-dot--transfer" />
                    <span className="pos-dash-channel-name">โอนธนาคาร</span>
                    <span className="pos-dash-channel-count">
                      {summary.transferCount.toLocaleString("th-TH")} บิล
                    </span>
                    <span className="pos-dash-channel-amt">
                      {formatPlainNumber(summary.transferTotal)} บาท
                    </span>
                  </li>
                </ul>
              </div>
              <p className="muted pos-dash-footnote">
                แยกตามช่องทางชำระจากยอดรับเงินหลังหักแลกแต้ม · แลกแต้มไม่เข้าเงินสด/ลิ้นชัก
              </p>
            </article>

            <article className="pos-dash-card pos-dash-card--void">
              <div className="pos-dash-card-head">
                <h3 className="pos-dash-card-title">บิลที่ยกเลิก</h3>
                <button
                  type="button"
                  className="npos-slim-text-btn pos-dash-more"
                  onClick={() => onOpenSessions?.({ voided: true })}
                >
                  ดูเพิ่มเติม
                </button>
              </div>
              <div className="pos-dash-void-box">
                <div>
                  <span className="pos-dash-void-label">ทำลาย</span>
                  <p className="pos-dash-void-value pos-dash-void-value--void">
                    {formatPlainNumber(summary.voidedTotal)} บาท
                  </p>
                  <span className="muted">
                    จำนวน {summary.voidedCount.toLocaleString("th-TH")} บิล
                  </span>
                </div>
                <div className="pos-dash-void-note">
                  <span className="muted">คืนเงิน</span>
                  <p className="muted">ยังไม่มีในระบบ</p>
                </div>
              </div>
            </article>
          </div>

          <div className="pos-dash-daily-block">
            <PosDashDailyTotalsTable
              points={byDay}
              weatherByDay={weatherByDay}
              weatherLoading={weatherLoading}
            />
            <PosDashDailyAreaChart points={byDay} />
          </div>

          <PosSalesDashboardMembers
            members={memberGrowth}
            memberBillCount={memberSalesTouch.memberBillCount}
            memberSalesTotal={memberSalesTouch.memberSalesTotal}
            onOpenMembers={() => router.push("/members/")}
          />

          <div className="pos-dash-chart-row">
            <div className="pos-dash-chart-row__hour">
              <PosDashHourBarChart points={byHour} />
              <p className="muted pos-dash-footnote">ตามเวลาขาย (ปิดบิล) — ไม่มีเวลาเปิดบิลแยก</p>
            </div>
            <div className="pos-dash-chart-row__weekday">
              <PosDashWeekdayBarChart points={byWeekday} />
            </div>
          </div>

          <div className="pos-dash-bottom-grid">
            <PosSalesDashboardProducts
              products={products}
              onOpenMenu={() => router.push("/menu/")}
            />

            <div className="pos-dash-bottom-side">
              <PosSalesDashboardStock
                stock={stockSummary}
                onOpenStock={() => router.push("/stock/")}
              />

              <article className="pos-dash-card">
                <h3 className="pos-dash-card-title">ส่วนลด / แลกแต้ม</h3>
                <p className="pos-dash-side-value">{formatPlainNumber(summary.discountTotal)} บาท</p>
                <p className="muted pos-dash-side-meta">
                  รวมส่วนลดที่หักจากยอดขาย · ไม่ใช่ช่องทางชำระ · บิลที่มีลด{" "}
                  {summary.discountCount.toLocaleString("th-TH")} · {discountBillPct.toFixed(2)}%
                </p>
                <dl className="pos-dash-breakdown pos-dash-breakdown--compact">
                  <div>
                    <dt>ส่วนลดมือ</dt>
                    <dd>−{formatPlainNumber(summary.manualDiscountTotal)}</dd>
                  </div>
                  <div>
                    <dt>แลกแต้ม (ไม่เข้าลิ้นชัก)</dt>
                    <dd>−{formatPlainNumber(summary.redeemTotal)}</dd>
                  </div>
                  <div>
                    <dt>บิลแลกแต้ม</dt>
                    <dd>{summary.redeemBillCount.toLocaleString("th-TH")}</dd>
                  </div>
                </dl>
              </article>

              <article className="pos-dash-card">
                <h3 className="pos-dash-card-title">แต้มสมาชิก</h3>
                <div className="pos-dash-stat-pair">
                  <div>
                    <span className="muted">แต้มที่ได้</span>
                    <strong>+{summary.pointsEarnedTotal.toLocaleString("th-TH")}</strong>
                    <span className="muted">จากยอดรับเงินหลังลด</span>
                  </div>
                  <div>
                    <span className="muted">แต้มที่ตัด</span>
                    <strong>−{summary.pointsRedeemedTotal.toLocaleString("th-TH")}</strong>
                    <span className="muted">
                      ส่วนลด ≈ {formatPlainNumber(summary.redeemTotal)} บาท
                    </span>
                  </div>
                </div>
                <p className="muted pos-dash-footnote">
                  แลกแต้มลดยอดก่อนรับเงิน — เงินสด/PP/โอนนับเฉพาะยอดที่รับจริง
                </p>
              </article>

              <article className="pos-dash-card">
                <h3 className="pos-dash-card-title">สถิติบิล</h3>
                <div className="pos-dash-stat-pair">
                  <div>
                    <span className="muted">จำนวนบิล</span>
                    <strong>{summary.activeCount.toLocaleString("th-TH")}</strong>
                    <span className="muted">เฉลี่ย {formatPlainNumber(avgDay)} บาท/วัน</span>
                  </div>
                  <div>
                    <span className="muted">จ่ายเงินเฉลี่ย</span>
                    <strong>{formatPlainNumber(avgBill)} บาท/บิล</strong>
                    <span className="muted">เฉลี่ยต่อบิล (ไม่ใช่ต่อลูกค้า)</span>
                  </div>
                  <div>
                    <span className="muted">จำนวนชิ้นที่ขาย</span>
                    <strong>{formatStockQty(unitCount)} ชิ้น</strong>
                    <span className="muted">
                      เฉลี่ย {formatPlainNumber(avgUnitsBill)} ชิ้น/บิล
                    </span>
                  </div>
                  <div>
                    <span className="muted">รายได้เฉลี่ยต่อชิ้น</span>
                    <strong>{formatPlainNumber(avgUnit)} บาท/ชิ้น</strong>
                    <span className="muted">ยอดสุทธิ ÷ จำนวนชิ้น (หน้าร้าน)</span>
                  </div>
                </div>
              </article>

              <article className="pos-dash-card">
                <h3 className="pos-dash-card-title">กิจกรรม</h3>
                <ul className="pos-dash-activity">
                  <li>
                    <span>บิลสำเร็จ</span>
                    <strong>{summary.activeCount.toLocaleString("th-TH")}</strong>
                  </li>
                  <li>
                    <span>บิลทำลาย</span>
                    <strong>{summary.voidedCount.toLocaleString("th-TH")}</strong>
                  </li>
                  <li className="pos-dash-activity--total">
                    <span>รวมบิล</span>
                    <strong>
                      {(summary.activeCount + summary.voidedCount).toLocaleString("th-TH")}
                    </strong>
                  </li>
                </ul>
              </article>
            </div>
          </div>
        </>
      ) : null}

      {!loading && !rangeTooLong && summary.activeCount === 0 && summary.voidedCount === 0 ? (
        <p className="muted pos-dash-empty">ยังไม่มีบิลในช่วงนี้ — ขายที่แท็บเล็ต POS</p>
      ) : null}
    </div>
  );
}
