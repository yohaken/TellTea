"use client";

import { Download } from "lucide-react";
import { PosSellView } from "@/components/PosSellView";
import { usePosApp } from "@/lib/pos-app-context";

export default function PosSellPage() {
  const {
    device,
    session,
    selling,
    shift,
    error,
    canInstall,
    standalone,
    handleOpenShift,
    installApp,
    syncSnap,
    setSellBusy,
  } = usePosApp();

  if (!device) return null;

  if (!selling || !session) {
    return (
      <main className="pos-page-center">
        <h1>พร้อมขาย</h1>
        <p className="muted">รหัสเครื่อง {device.pairingCode}</p>
        <p className="muted pos-sell-clock-hint">กดเข้างานเมื่อเริ่มขาย — บันทึกเวลาเข้า-ออกจริง</p>

        {!standalone && canInstall ? (
          <button type="button" className="ghost-btn pos-lite-btn" onClick={() => void installApp()}>
            <Download size={16} aria-hidden />
            ติดตั้งแอป
          </button>
        ) : null}

        {error ? <p className="error-text">{error}</p> : null}

        <button
          type="button"
          className="primary-btn pos-open-shift-btn"
          onClick={handleOpenShift}
        >
          เข้างาน
        </button>
      </main>
    );
  }

  return (
    <PosSellView
      deviceId={device.id}
      devicePairingCode={device.pairingCode}
      session={session}
      pendingBills={syncSnap.bills}
      onBusyChange={(state) => setSellBusy((prev) => ({ ...prev, ...state }))}
    />
  );
}
