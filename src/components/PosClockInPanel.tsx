"use client";

import { useEffect, useState } from "react";
import { getCurrentShiftId } from "@/lib/shift-session";
import { labelOtShift, type OtShiftId } from "@/lib/ot";

const SHIFT_WINDOW: Record<OtShiftId, string> = {
  late: "00:18 – 07:00",
  morning: "07:00 – 17:00",
  evening: "17:00 – 00:18",
};

function formatLiveClock(now: Date) {
  return now.toLocaleTimeString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatLiveDate(now: Date) {
  return now.toLocaleDateString("th-TH", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** หน้าพร้อมขาย — นาฬิกาเดิน + สรุปกะที่จะเริ่มตามมาตรฐาน TellTea */
export function PosClockInPanel({
  pairingCode,
  error,
  canInstall,
  standalone,
  onInstall,
  onOpenShift,
}: {
  pairingCode: string;
  error: string | null;
  canInstall: boolean;
  standalone: boolean;
  onInstall: () => void;
  onOpenShift: () => void;
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const shiftId = getCurrentShiftId(now);
  const shiftLabel = labelOtShift(shiftId);
  const shiftWindow = SHIFT_WINDOW[shiftId];

  return (
    <main className="pos-page-center pos-clock-in">
      <h1 className="pos-clock-in-title">พร้อมขาย</h1>

      <section className="pos-clock-in-card" aria-label="ข้อมูลเข้างาน">
        <div className="pos-clock-in-now">
          <span className="pos-clock-in-now-label">เวลาปัจจุบัน</span>
          <strong className="pos-clock-in-time" aria-live="polite">
            {formatLiveClock(now)}
          </strong>
          <span className="pos-clock-in-date">{formatLiveDate(now)}</span>
        </div>

        <table className="pos-clock-in-table">
          <tbody>
            <tr>
              <th scope="row">รหัสเครื่อง</th>
              <td>
                <strong className="pos-clock-in-code">{pairingCode}</strong>
              </td>
            </tr>
            <tr>
              <th scope="row">กะอ้างอิง</th>
              <td>
                <strong>{shiftLabel}</strong>
              </td>
            </tr>
            <tr>
              <th scope="row">ช่วงมาตรฐาน</th>
              <td>{shiftWindow}</td>
            </tr>
            <tr>
              <th scope="row">เริ่มรอบเมื่อ</th>
              <td>กดเข้างาน — บันทึกเวลาจริง</td>
            </tr>
            <tr>
              <th scope="row">ปิดรอบเมื่อ</th>
              <td>ออกงาน (ไม่ตัดอัตโนมัติ)</td>
            </tr>
          </tbody>
        </table>
      </section>

      <p className="muted pos-clock-in-hint">
        กดเข้างานเมื่อเริ่มขาย — เวลานับเดินหลังเข้างาน · กะยืดหยุ่นข้ามเที่ยงคืนได้
      </p>

      {!standalone && canInstall ? (
        <button type="button" className="ghost-btn pos-lite-btn" onClick={onInstall}>
          ติดตั้งแอป
        </button>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}

      <button type="button" className="primary-btn pos-open-shift-btn" onClick={onOpenShift}>
        เข้างาน
      </button>
    </main>
  );
}
