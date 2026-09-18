"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clock, Users, X } from "lucide-react";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import {
  fmtDeductPct,
  isOtIncompleteEnforcementActive,
  otIncompleteEnforcementLabel,
  OT_INCOMPLETE_DEDUCT_PCT_PER_SHIFT,
  shiftCountdownUrgency,
  splitShiftCountdown,
  sumIncompletePreviewDeductPct,
} from "@/lib/shift-deadline";
import type { PastIncompleteOtShift } from "@/lib/shift-session";
import { labelShiftSlotStatus } from "@/lib/shift-session";
import { thaiMonthYearLabel } from "@/lib/bonus";

/**
 * ป๊อปอัปเตือนกะที่พ้นเวลาทำงานแล้วยังไม่ครบ — ทีมเห็นทั้งร้าน
 * Super-slim: เนื้อหาทั้งก้อนอยู่ในจอ ไม่ต้องเลื่อน
 */
export function OtIncompletePopup({
  items,
  onOpenSlot,
}: {
  items: PastIncompleteOtShift[];
  onOpenSlot: (item: PastIncompleteOtShift) => void;
}) {
  const fingerprint = useMemo(
    () =>
      items
        .map(
          (i) =>
            `${i.date}_${i.shift}:${i.missingLabels.join(",")}:${i.overdue ? "o" : i.countdownMs}`,
        )
        .join("|"),
    [items],
  );
  const [dismissedFp, setDismissedFp] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    setDismissedFp(null);
  }, [fingerprint]);

  const open = items.length > 0 && dismissedFp !== fingerprint;
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [open]);

  const liveItems = useMemo(() => {
    const now = new Date(nowMs);
    return items.map((item) => {
      const deadlineMs = item.deadlineMs;
      const t = now.getTime();
      const overdue = t >= deadlineMs;
      const countdownMs = overdue ? 0 : deadlineMs - t;
      return {
        ...item,
        overdue,
        countdownMs,
        previewDeductPct: overdue ? OT_INCOMPLETE_DEDUCT_PCT_PER_SHIFT : 0,
      };
    });
  }, [items, nowMs]);

  const urgent = useMemo(
    () =>
      [...liveItems]
        .filter((i) => !i.overdue)
        .sort((a, b) => a.countdownMs - b.countdownMs),
    [liveItems],
  );
  const overdue = useMemo(() => liveItems.filter((i) => i.overdue), [liveItems]);
  const hero = urgent[0] ?? null;
  const totalDeductPct = sumIncompletePreviewDeductPct(liveItems);
  const enforceLabel = otIncompleteEnforcementLabel(new Date(nowMs));
  const enforceActive = isOtIncompleteEnforcementActive(new Date(nowMs));
  const graceMonthLabel = thaiMonthYearLabel(
    new Date(nowMs).getFullYear(),
    new Date(nowMs).getMonth(),
  );

  if (!open) return null;

  /** แถวเดียวต่อกะ · จำกัดพอให้พอดีจอ */
  const shownUrgent = urgent.slice(0, 5);
  const shownOverdue = overdue.slice(0, 6);
  const hiddenCount = Math.max(0, liveItems.length - shownUrgent.length - shownOverdue.length);

  function dismiss() {
    setDismissedFp(fingerprint);
  }

  function openHero() {
    const target = hero ?? overdue[0];
    if (!target) return;
    dismiss();
    onOpenSlot(target);
  }

  function openSlot(item: PastIncompleteOtShift) {
    dismiss();
    onOpenSlot(item);
  }

  return (
    <div className="modal-backdrop alert-backdrop ot-incomplete-backdrop" role="presentation">
      <div
        className="modal-card ot-incomplete-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ot-incomplete-title"
      >
        <div className="ot-incomplete-head">
          <p id="ot-incomplete-title" className="ot-incomplete-kicker">
            <Users size={12} aria-hidden />
            ทีมค้าง {liveItems.length} กะ
            {hero ? (
              <span className="ot-incomplete-head-clock">
                <Clock size={10} aria-hidden />
                <ShiftCountdownClock ms={hero.countdownMs} size="row" />
              </span>
            ) : overdue.length ? (
              <span className="ot-incomplete-head-clock is-overdue">
                <AlertTriangle size={10} aria-hidden />
                เลย 24 ชม.
              </span>
            ) : null}
          </p>
          <button
            type="button"
            className="ghost-btn icon-btn ot-incomplete-close"
            aria-label="ปิดการแจ้งเตือน"
            onClick={dismiss}
          >
            <X size={14} aria-hidden />
          </button>
        </div>

        <p
          className={
            enforceActive
              ? "ot-incomplete-meta ot-incomplete-meta--live"
              : "ot-incomplete-meta"
          }
        >
          {!enforceActive
            ? `${graceMonthLabel} · ยังไม่หักจริง · เริ่ม ${enforceLabel}`
            : `หัก ${fmtDeductPct(OT_INCOMPLETE_DEDUCT_PCT_PER_SHIFT)}/กะ หลัง 24 ชม.`}
          {totalDeductPct > 0
            ? ` · สะสม −${fmtDeductPct(totalDeductPct)} (${overdue.length})`
            : ""}
        </p>

        {shownUrgent.length ? (
          <ul className="ot-incomplete-list">
            {shownUrgent.map((item) => (
              <IncompleteShiftRow
                key={`${item.date}_${item.shift}`}
                item={item}
                onPick={openSlot}
                dismiss={dismiss}
              />
            ))}
          </ul>
        ) : null}

        {shownOverdue.length ? (
          <>
            <p className="ot-incomplete-section-label ot-incomplete-section-label--overdue">
              เลย 24 ชม.
              {!enforceActive ? " · ยังไม่หักจริง" : ""}
            </p>
            <ul className="ot-incomplete-list">
              {shownOverdue.map((item) => (
                <IncompleteShiftRow
                  key={`${item.date}_${item.shift}`}
                  item={item}
                  onPick={openSlot}
                  dismiss={dismiss}
                  overdue
                />
              ))}
            </ul>
          </>
        ) : null}

        {hiddenCount > 0 ? (
          <p className="muted ot-incomplete-more">+อีก {hiddenCount} กะในตาราง</p>
        ) : null}

        <div className="ot-incomplete-actions">
          {hero || overdue.length ? (
            <button type="button" className="primary-btn" onClick={openHero}>
              ไปใส่กะเร่ง
            </button>
          ) : null}
          <button type="button" className="ghost-btn" onClick={dismiss}>
            ปิด
          </button>
        </div>
      </div>
    </div>
  );
}

function ShiftCountdownClock({ ms, size }: { ms: number; size: "hero" | "row" }) {
  const { hours, minutes, seconds } = splitShiftCountdown(ms);
  const urgency = shiftCountdownUrgency(ms);
  return (
    <span
      className={`ot-countdown-clock is-${size} is-${urgency}`}
      aria-label={`เหลือ ${hours} ชั่วโมง ${minutes} นาที ${seconds} วินาที`}
    >
      <span className="ot-countdown-hms">
        {String(hours).padStart(2, "0")}:{String(minutes).padStart(2, "0")}:
        {String(seconds).padStart(2, "0")}
      </span>
    </span>
  );
}

function IncompleteShiftRow({
  item,
  onPick,
  dismiss,
  overdue: overdueRow,
}: {
  item: PastIncompleteOtShift;
  onPick: (item: PastIncompleteOtShift) => void;
  dismiss: () => void;
  overdue?: boolean;
}) {
  const workers = (item.entry?.workerNames || []).filter(Boolean);
  const workerShort = workers.length
    ? workers.length === 1
      ? workers[0]
      : `${workers[0]}+${workers.length - 1}`
    : "—";
  const missingShort = item.missingLabels.join("·");

  return (
    <li className={`ot-incomplete-item${overdueRow ? " is-overdue" : ""}`}>
      <button
        type="button"
        className="ot-incomplete-item-btn"
        onClick={() => {
          dismiss();
          onPick(item);
        }}
      >
        <span className="ot-incomplete-item-main">
          <span className="ot-incomplete-item-when">
            {item.dateLabel} {item.shiftLabel}
          </span>
          <span className="ot-incomplete-item-status">{labelShiftSlotStatus(item.status)}</span>
          <span className="ot-incomplete-item-workers muted">{workerShort}</span>
        </span>
        <span className="ot-incomplete-item-side">
          <span className="ot-incomplete-item-missing" title={item.missingLabels.join(" · ")}>
            {missingShort}
          </span>
          <span className={`ot-incomplete-item-countdown${overdueRow ? " is-overdue" : ""}`}>
            {overdueRow ? (
              `−${fmtDeductPct(item.previewDeductPct)}`
            ) : (
              <ShiftCountdownClock ms={item.countdownMs} size="row" />
            )}
          </span>
        </span>
      </button>
    </li>
  );
}
