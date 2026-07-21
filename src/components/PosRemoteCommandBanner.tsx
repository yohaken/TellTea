"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, RefreshCw, X } from "lucide-react";
import {
  ackPosDeviceOwnerPing,
  subscribePosDevice,
} from "@/lib/pos-devices";
import { isPosSafeToReload, type PosSellBusyState } from "@/lib/pos-reload";

/**
 * คำสั่งจากหลังบ้าน:
 * - ping → ป๊อปทันที (ไม่รีโหลด) ใช้ทดสอบตอนกำลังขายได้
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
          setPingMsg(next.ownerPingMessage || "ข้อความจากร้าน");
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

  if (!pingMsg && !pendingReload) return null;

  return (
    <div className="pos-remote-cmd" role="status">
      {pingMsg ? (
        <div className="pos-remote-cmd-ping">
          <Bell size={18} aria-hidden />
          <div className="pos-remote-cmd-copy">
            <strong>ข้อความจากร้าน</strong>
            <span>{pingMsg}</span>
          </div>
          <button
            type="button"
            className="ghost-btn pos-remote-cmd-dismiss"
            onClick={() => setPingMsg(null)}
            aria-label="ปิด"
          >
            <X size={16} aria-hidden />
          </button>
        </div>
      ) : null}

      {pendingReload ? (
        <div className="pos-remote-cmd-reload">
          <RefreshCw size={16} aria-hidden />
          <span>
            มีคำสั่งอัปเดตจากร้าน — จะรีโหลดเองเมื่อตะกร้าว่าง (ไม่ขัดจังหวะขาย)
          </span>
        </div>
      ) : null}
    </div>
  );
}
