"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, Camera, RefreshCw, X } from "lucide-react";
import {
  ackPosDeviceOwnerPing,
  subscribePosDevice,
} from "@/lib/pos-devices";
import { isPosSafeToReload, type PosSellBusyState } from "@/lib/pos-reload";

export const POS_OWNER_PING_DEFAULT_MESSAGE =
  "ถ้าเห็นข้อความนี้ ให้ทักบอกพี่ หรือถ่ายรูปหน้าจอนี้ส่งมา — แปลว่าระบบอัปเดตจากร้านทำงานแล้ว";

/**
 * คำสั่งจากหลังบ้าน:
 * - ping → ป๊อปเต็มจอทันที (ไม่รีโหลด) ใช้พิสูจน์ช่องทางตอนทดสอบ
 * - force reload ค้าง → แบนเนอร์ว่าจะรีโหลดเมื่อตะกร้าว่าง
 */
export function PosRemoteCommandBanner({
  enabled,
  deviceId,
  sellBusy,
}: {
  enabled: boolean;
  deviceId: string | null;
  sellBusy: PosSellBusyState;
}) {
  const [pingMsg, setPingMsg] = useState<string | null>(null);
  const [pendingReload, setPendingReload] = useState(false);
  const lastPingAck = useRef(0);

  useEffect(() => {
    if (!enabled || !deviceId) return;

    return subscribePosDevice(
      deviceId,
      (next) => {
        if (!next) return;

        const pingPending =
          next.ownerPingAt > 0 && next.ownerPingAt > (next.lastOwnerPingAckAt || 0);
        if (pingPending && next.ownerPingAt !== lastPingAck.current) {
          lastPingAck.current = next.ownerPingAt;
          setPingMsg(next.ownerPingMessage || POS_OWNER_PING_DEFAULT_MESSAGE);
          void ackPosDeviceOwnerPing(deviceId, next.ownerPingAt).catch(() => {});
        }

        const reloadPending =
          next.forceReloadAt > 0 && next.forceReloadAt > next.lastReloadAckAt;
        if (reloadPending && !isPosSafeToReload(sellBusy)) {
          setPendingReload(true);
        } else if (!reloadPending) {
          setPendingReload(false);
        }
      },
    );
  }, [deviceId, enabled, sellBusy]);

  return (
    <>
      {pingMsg ? (
        <div className="pos-remote-ping-modal" role="alertdialog" aria-modal="true" aria-labelledby="pos-ping-title">
          <div className="pos-remote-ping-modal-card">
            <div className="pos-remote-ping-modal-icon" aria-hidden>
              <Bell size={28} />
            </div>
            <h2 id="pos-ping-title">ข้อความจากร้าน</h2>
            <p className="pos-remote-ping-modal-body">{pingMsg}</p>
            <p className="pos-remote-ping-modal-hint">
              <Camera size={16} aria-hidden />
              ทักพี่ หรือถ่ายรูปจอนี้ส่งมาได้เลย
            </p>
            <button type="button" className="primary-btn" onClick={() => setPingMsg(null)}>
              เห็นแล้ว ปิดได้
            </button>
            <button
              type="button"
              className="ghost-btn pos-remote-ping-modal-x"
              onClick={() => setPingMsg(null)}
              aria-label="ปิด"
            >
              <X size={18} aria-hidden />
            </button>
          </div>
        </div>
      ) : null}

      {pendingReload ? (
        <div className="pos-remote-cmd" role="status">
          <div className="pos-remote-cmd-reload">
            <RefreshCw size={16} aria-hidden />
            <span>
              มีคำสั่งอัปเดตจากร้าน — จะรีโหลดเองเมื่อตะกร้าว่าง (ไม่ขัดจังหวะขาย)
            </span>
          </div>
        </div>
      ) : null}
    </>
  );
}
