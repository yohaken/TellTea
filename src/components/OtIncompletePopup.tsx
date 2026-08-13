"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import type { PastIncompleteOtShift } from "@/lib/shift-session";
import { labelShiftSlotStatus } from "@/lib/shift-session";

/**
 * ป๊อปอัปเตือนกะที่พ้นเวลาทำงานแล้วยังไม่ครบ — ปิดได้ในรอบเข้าหน้านี้
 * เข้า /ot/ ใหม่แล้วยังค้างจะเด้งอีก
 */
export function OtIncompletePopup({
  items,
  onOpenSlot,
}: {
  items: PastIncompleteOtShift[];
  onOpenSlot: (item: PastIncompleteOtShift) => void;
}) {
  const fingerprint = useMemo(
    () => items.map((i) => `${i.date}_${i.shift}:${i.missingLabels.join(",")}`).join("|"),
    [items],
  );
  const [dismissedFp, setDismissedFp] = useState<string | null>(null);

  useEffect(() => {
    setDismissedFp(null);
  }, [fingerprint]);

  const open = items.length > 0 && dismissedFp !== fingerprint;
  useBodyScrollLock(open);

  if (!open) return null;

  const shown = items.slice(0, 12);
  const more = items.length - shown.length;

  function dismiss() {
    setDismissedFp(fingerprint);
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
            <AlertTriangle size={16} aria-hidden />
            ยังไม่ได้ลงข้อมูลกะครบ
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

        <h2 id="ot-incomplete-title" className="ot-incomplete-title">
          มี {items.length} กะที่ผ่านเวลาทำงานแล้ว ต้องใส่ข้อมูลให้ครบก่อน
        </h2>
        <p className="ot-incomplete-lead muted">
          รวมพนักงานกะ · เช็คเปิด/ปิดกะ · ยอดชง · และรูปภาพ — กะว่างที่ยังไม่แตะก็ถือว่ายังไม่ครบ
        </p>

        <ul className="ot-incomplete-list">
          {shown.map((item) => (
            <li key={`${item.date}_${item.shift}`} className="ot-incomplete-item">
              <button
                type="button"
                className="ot-incomplete-item-btn"
                onClick={() => {
                  dismiss();
                  onOpenSlot(item);
                }}
              >
                <span className="ot-incomplete-item-when">
                  {item.dateLabel} · {item.shiftLabel}
                  <span className="ot-incomplete-item-status">
                    {labelShiftSlotStatus(item.status)}
                  </span>
                </span>
                <span className="ot-incomplete-item-missing">
                  ต้องทำ: {item.missingLabels.join(" · ")}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {more > 0 ? (
          <p className="muted ot-incomplete-more">และอีก {more} กะ — ดูในตารางด้านล่าง</p>
        ) : null}

        <div className="ot-incomplete-actions">
          <button type="button" className="ghost-btn" onClick={dismiss}>
            ปิดไปก่อน
          </button>
        </div>
      </div>
    </div>
  );
}
