"use client";

import { useMemo, useState } from "react";
import { usePosApp } from "@/lib/pos-app-context";
import { closePosSession } from "@/lib/pos-session";
import { labelOtShift } from "@/lib/ot";
import { formatPlainNumber } from "@/lib/utils";

export function PosShiftView() {
  const { session, device, selling, shift, setError } = usePosApp();
  const [closing, setClosing] = useState(false);
  const [tab, setTab] = useState<"current" | "history">("current");

  const shiftLabel = useMemo(() => labelOtShift(shift as "late" | "morning" | "evening"), [shift]);

  async function handleCloseShift() {
    if (!session || !selling) return;
    if (!window.confirm("ปิดรอบการขายกะนี้?")) return;
    setClosing(true);
    try {
      await closePosSession(session.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setClosing(false);
    }
  }

  return (
    <div className="pos-module">
      <div className="pos-module-subnav">
        <button type="button" className={tab === "current" ? "is-active" : ""} onClick={() => setTab("current")}>
          รอบการขายปัจจุบัน
        </button>
        <button type="button" className={tab === "history" ? "is-active" : ""} onClick={() => setTab("history")}>
          ประวัติรอบการขาย
        </button>
      </div>

      <div className="pos-module-content">
        {tab === "current" ? (
          selling && session ? (
            <>
              <h2>รอบการขายปัจจุบัน</h2>
              <dl className="pos-shift-dl">
                <div>
                  <dt>เวลาเปิดรอบ</dt>
                  <dd>
                    {new Date(session.openedAt).toLocaleString("th-TH", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </dd>
                </div>
                <div>
                  <dt>รหัสรอบ</dt>
                  <dd>#{session.id.slice(-4).toUpperCase()}</dd>
                </div>
                <div>
                  <dt>กะ</dt>
                  <dd>{shiftLabel}</dd>
                </div>
                <div>
                  <dt>ยอดขาย</dt>
                  <dd>฿{formatPlainNumber(session.totalSales)}</dd>
                </div>
                <div>
                  <dt>จำนวนบิล</dt>
                  <dd>{session.saleCount}</dd>
                </div>
                <div>
                  <dt>เครื่อง</dt>
                  <dd>{device?.pairingCode}</dd>
                </div>
              </dl>
              <div className="pos-shift-actions">
                <button
                  type="button"
                  className="primary-btn pos-shift-close-btn"
                  disabled={closing}
                  onClick={() => void handleCloseShift()}
                >
                  {closing ? "กำลังปิด..." : "ปิดรอบการขาย"}
                </button>
              </div>
            </>
          ) : (
            <div className="pos-module-empty">
              <h2>ยังไม่ได้เปิดรอบขาย</h2>
              <p className="muted">ไปที่ สั่งและชำระเงิน แล้วกดเปิดขายกะนี้</p>
            </div>
          )
        ) : (
          <div className="pos-module-empty">
            <h2>ประวัติรอบการขาย</h2>
            <p className="muted">ดูรายละเอียดเต็มที่ TellTea หลังร้าน → รายงานขาย POS</p>
          </div>
        )}
      </div>
    </div>
  );
}
