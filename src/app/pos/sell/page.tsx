"use client";

import { Download } from "lucide-react";
import { PosSellView } from "@/components/PosSellView";
import { usePosApp } from "@/lib/pos-app-context";
import { labelOtShift } from "@/lib/ot";

export default function PosSellPage() {
  const {
    device,
    session,
    selling,
    shift,
    error,
    opening,
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
        <p className="muted">กะ {labelOtShift(shift)} · รหัส {device.pairingCode}</p>

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
          disabled={opening}
          onClick={() => void handleOpenShift()}
        >
          {opening ? "กำลังเปิด..." : "เปิดขายกะนี้"}
        </button>
      </main>
    );
  }

  return (
    <PosSellView
      deviceId={device.id}
      session={session}
      pendingBills={syncSnap.bills}
      onBusyChange={(state) => setSellBusy((prev) => ({ ...prev, ...state }))}
    />
  );
}
