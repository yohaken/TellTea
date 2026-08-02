"use client";

import { useEffect, useMemo, useState } from "react";
import { Calendar } from "lucide-react";
import {
  clampPosDateRange,
  defaultPosDashboardRange,
  formatPosDateRangeLabel,
  POS_DASHBOARD_MAX_RANGE_DAYS,
  posDateRangeDayCount,
  posRangeDayInputValue,
  subscribePosSalesForDateRange,
  summarizePosSalesDetailed,
  type PosDateRange,
} from "@/lib/pos-sales-report";
import type { PosSale } from "@/lib/types";
import { formatPlainNumber, parseDateInput, startOfLocalDay } from "@/lib/utils";

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
  const [range, setRange] = useState<PosDateRange>(() => defaultPosDashboardRange());
  const [draftStart, setDraftStart] = useState(() => posRangeDayInputValue(range.startMs));
  const [draftEnd, setDraftEnd] = useState(() => posRangeDayInputValue(range.endMs));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sales, setSales] = useState<PosSale[]>([]);
  const [loading, setLoading] = useState(true);

  const clamped = useMemo(() => clampPosDateRange(range), [range]);
  const dayCount = useMemo(() => posDateRangeDayCount(clamped), [clamped]);
  const rangeTooLong = dayCount > POS_DASHBOARD_MAX_RANGE_DAYS;

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
      },
      (err) => {
        onError?.(err.message);
        setLoading(false);
      },
    );
  }, [clamped, rangeTooLong, onError]);

  const summary = useMemo(() => summarizePosSalesDetailed(sales), [sales]);
  const tenders = useMemo(() => tenderSegments(summary), [summary]);
  const label = formatPosDateRangeLabel(clamped);

  function applyDraftRange() {
    onError?.(null);
    try {
      const startMs = startOfLocalDay(parseDateInput(draftStart));
      const endMs = startOfLocalDay(parseDateInput(draftEnd));
      const next = clampPosDateRange({ startMs, endMs });
      if (posDateRangeDayCount(next) > POS_DASHBOARD_MAX_RANGE_DAYS) {
        onError?.(`เลือกได้ไม่เกิน ${POS_DASHBOARD_MAX_RANGE_DAYS} วัน`);
        return;
      }
      setRange(next);
      setPickerOpen(false);
    } catch (err) {
      onError?.((err as Error).message || "วันที่ไม่ถูกต้อง");
    }
  }

  function setPreset(kind: "today" | "month" | "last7") {
    const today = startOfLocalDay();
    if (kind === "today") {
      setRange({ startMs: today, endMs: today });
    } else if (kind === "last7") {
      setRange(
        clampPosDateRange({
          startMs: today - 6 * 24 * 60 * 60 * 1000,
          endMs: today,
        }),
      );
    } else {
      setRange(defaultPosDashboardRange());
    }
    setPickerOpen(false);
  }

  const donutStyle = {
    background: conicFromTenders(tenders.cashPct, tenders.promptpayPct, tenders.transferPct),
  } as const;

  return (
    <div className="pos-dash">
      <div className="pos-dash-toolbar">
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

      {rangeTooLong ? (
        <p className="error-text">ช่วงวันที่ยาวเกิน {POS_DASHBOARD_MAX_RANGE_DAYS} วัน — ย่อช่วงก่อน</p>
      ) : null}
      {loading ? <p className="empty">กำลังโหลดแดชบอร์ด...</p> : null}

      {!loading && !rangeTooLong ? (
        <div className="pos-dash-top-grid">
          <article className="pos-dash-card pos-dash-card--net">
            <h3 className="pos-dash-card-title">ยอดขายสุทธิ</h3>
            <p className="pos-dash-net-value">
              {formatPlainNumber(summary.total)} <span>บาท</span>
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
                  <dt>ส่วนลด</dt>
                  <dd>−{formatPlainNumber(summary.discountTotal)} บาท</dd>
                </div>
                <div className="pos-dash-breakdown--total">
                  <dt>รวมสุทธิ</dt>
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
            <p className="muted pos-dash-footnote">แยกตามช่องทางชำระ (ไม่แยกประเภทออเดอร์)</p>
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
                <span className="muted">จำนวน {summary.voidedCount.toLocaleString("th-TH")} บิล</span>
              </div>
              <div className="pos-dash-void-note">
                <span className="muted">คืนเงิน</span>
                <p className="muted">ยังไม่มีในระบบ</p>
              </div>
            </div>
          </article>
        </div>
      ) : null}

      {!loading && !rangeTooLong && summary.activeCount === 0 && summary.voidedCount === 0 ? (
        <p className="muted pos-dash-empty">ยังไม่มีบิลในช่วงนี้ — ขายที่แท็บเล็ต POS</p>
      ) : null}
    </div>
  );
}
