"use client";

import { PosSellView } from "@/components/PosSellView";
import { PosClockInPanel } from "@/components/PosClockInPanel";
import { usePosApp } from "@/lib/pos-app-context";

export default function PosSellPage() {
  const {
    device,
    session,
    selling,
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
      <PosClockInPanel
        pairingCode={device.pairingCode}
        error={error}
        canInstall={canInstall}
        standalone={standalone}
        onInstall={() => void installApp()}
        onOpenShift={handleOpenShift}
      />
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
