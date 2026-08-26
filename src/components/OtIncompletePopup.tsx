"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clock, Users, X } from "lucide-react";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import {
  fmtDeductPct,
  formatShiftCountdownHero,
  formatShiftCountdownShort,
  isOtIncompleteEnforcementActive,
  otIncompleteEnforcementLabel,
  OT_INCOMPLETE_DEDUCT_PCT_PER_SHIFT,
  sumIncompletePreviewDeductPct,
} from "@/lib/shift-deadline";
import type { PastIncompleteOtShift } from "@/lib/shift-session";
import { labelShiftSlotStatus } from "@/lib/shift-session";
import { thaiMonthYearLabel } from "@/lib/bonus";

/**
 * ป๊อปอัปเตือนกะที่พ้นเวลาทำงานแล้วยังไม่ครบ — ทีมเห็นทั้งร้าน
 * นับถอยหลัง 24 ชม. · แสดงหักสะสม 0.3%/กะ (ยังไม่หักจริงจนเดือนหน้า)
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
    const hasUrgent = items.some((i) => !i.overdue);
    const intervalMs = hasUrgent && items.some((i) => !i.overdue && i.countdownMs < 3_600_000)
      ? 1000
      : 30_000;
    const id = window.setInterval(() => setNowMs(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [open, items]);

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

  const shownUrgent = urgent.slice(0, 6);
  const shownOverdue = overdue.slice(0, 8);
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

  return (
    <div className="modal-backdrop alert-backdrop ot-incomplete-backdrop" role="presentation">
      <div
        className="modal-card ot-incomplete-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ot-incomplete-title"
      >
        <div className="ot-incomplete-head">
          <p className="ot-incomplete-kicker">
            <Users size={16} aria-hidden />
            ทีมยังใส่ข้อมูลกะไม่ครบ
          </p>
          <button
            type="button"
            className="ghost-btn icon-btn"
            aria-label="ปิดการแจ้งเตือน"
            onClick={dismiss}
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        {!enforceActive ? (
          <p className="ot-incomplete-grace">
            เดือน {graceMonthLabel} — <strong>ยังไม่หักโบนัสจริง</strong> · เริ่มหักสะสม{" "}
            {enforceLabel}
          </p>
        ) : (
          <p className="ot-incomplete-grace ot-incomplete-grace--live">
            กติกาหักโบนัสมีผลแล้ว — กะเลย 24 ชม. หักสะสม {fmtDeductPct(OT_INCOMPLETE_DEDUCT_PCT_PER_SHIFT)}/กะ
          </p>
        )}

        {totalDeductPct > 0 ? (
          <p className="ot-incomplete-deduct">
            สะสมหักโบนัส <strong>−{fmtDeductPct(totalDeductPct)}</strong> ({overdue.length} กะเลย
            24 ชม.)
            {!enforceActive ? (
              <span className="ot-incomplete-deduct-note"> · ยังไม่หักจริง — แก้ให้ครบก่อน {enforceLabel}</span>
            ) : null}
          </p>
        ) : null}

        {hero ? (
          <div className="ot-incomplete-hero" aria-live="polite">
            <p className="ot-incomplete-hero-label">
              <Clock size={14} aria-hidden />
              เหลือเวลาใส่ครบ
            </p>
            <p className="ot-incomplete-hero-time">{formatShiftCountdownHero(hero.countdownMs)}</p>
            <p className="ot-incomplete-hero-slot muted">
              {hero.dateLabel} · {hero.shiftLabel}
            </p>
          </div>
        ) : overdue.length ? (
          <div className="ot-incomplete-hero ot-incomplete-hero--overdue">
            <p className="ot-incomplete-hero-label">
              <AlertTriangle size={14} aria-hidden />
              ทุกกะค้างเลย 24 ชม. แล้ว
            </p>
            <p className="ot-incomplete-hero-time ot-incomplete-hero-time--warn">
              {overdue.length} กะ
            </p>
          </div>
        ) : null}

        <h2 id="ot-incomplete-title" className="ot-incomplete-title">
          ทีมมี {liveItems.length} กะค้าง — ช่วยกันใส่ให้ครบภายใน 24 ชม. หลังจบกะ
        </h2>
        <p className="ot-incomplete-lead muted">
          พนักงานกะ · เช็คเปิด/ปิดกะ · ยอดชง · รูปภาพ — กะว่างที่ยังไม่แตะก็ถือว่ายังไม่ครบ ·
          ทุกคนในทีมเห็นรายการเดียวกัน
        </p>

        {shownUrgent.length ? (
          <>
            <p className="ot-incomplete-section-label">ใกล้หมดเวลา</p>
            <ul className="ot-incomplete-list">
              {shownUrgent.map((item) => (
                <IncompleteShiftRow key={`${item.date}_${item.shift}`} item={item} onPick={openSlot} dismiss={dismiss} />
              ))}
            </ul>
          </>
        ) : null}

        {shownOverdue.length ? (
          <>
            <p className="ot-incomplete-section-label ot-incomplete-section-label--overdue">
              เลย 24 ชม. แล้ว
              {!enforceActive ? " · ยังไม่หักจริง" : null}
            </p>
            <ul className="ot-incomplete-list">
              {shownOverdue.map((item) => (
                <IncompleteShiftRow key={`${item.date}_${item.shift}`} item={item} onPick={openSlot} dismiss={dismiss} overdue />
              ))}
            </ul>
          </>
        ) : null}

        {hiddenCount > 0 ? (
          <p className="muted ot-incomplete-more">และอีก {hiddenCount} กะ — ดูในตารางด้านล่าง</p>
        ) : null}

        <div className="ot-incomplete-actions">
          {hero || overdue.length ? (
            <button type="button" className="primary-btn" onClick={openHero}>
              ไปใส่กะที่เร่งที่สุด
            </button>
          ) : null}
          <button type="button" className="ghost-btn" onClick={dismiss}>
            ปิดไปก่อน
          </button>
        </div>
      </div>
    </div>
  );

  function openSlot(item: PastIncompleteOtShift) {
    dismiss();
    onOpenSlot(item);
  }
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
  const workerLabel = workers.length ? workers.join(", ") : "ยังไม่ระบุคนในกะ";

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
        <span className="ot-incomplete-item-when">
          {item.dateLabel} · {item.shiftLabel}
          <span className="ot-incomplete-item-status">
            {labelShiftSlotStatus(item.status)}
          </span>
          {overdueRow && item.previewDeductPct > 0 ? (
            <span className="ot-incomplete-item-deduct">−{fmtDeductPct(item.previewDeductPct)}</span>
          ) : null}
        </span>
        <span className="ot-incomplete-item-workers muted">{workerLabel}</span>
        <span className="ot-incomplete-item-missing">
          ต้องทำ: {item.missingLabels.join(" · ")}
        </span>
        <span className={`ot-incomplete-item-countdown${overdueRow ? " is-overdue" : ""}`}>
          {overdueRow
            ? `เลย 24 ชม. · สะสม −${fmtDeductPct(item.previewDeductPct)}`
            : formatShiftCountdownShort(item.countdownMs)}
        </span>
      </button>
    </li>
  );
}
