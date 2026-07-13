"use client";

import { usePosApp } from "@/lib/pos-app-context";
import { PosHardLink } from "@/components/PosHardLink";

export function PosLockScreen() {
  const { device, setLocked } = usePosApp();

  return (
    <div className="pos-lock-screen">
      <div className="pos-lock-card">
        <h1>TellTea POS</h1>
        <p className="muted">หน้าจอล็อก</p>
        {device ? (
          <p className="pos-lock-code">
            รหัสเครื่อง <strong>{device.pairingCode}</strong>
          </p>
        ) : null}
        <button type="button" className="primary-btn pos-lock-unlock" onClick={() => setLocked(false)}>
          ปลดล็อก
        </button>
        <PosHardLink href="/pos/sell/" className="ghost-btn">
          ไปหน้าขาย
        </PosHardLink>
      </div>
    </div>
  );
}
