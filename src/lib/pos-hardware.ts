import { getPrinterReadiness } from "./pos-printer/router";
import { getCachedPrinterSetup } from "./pos-printer/storage";

export type PosHardwareSnapshot = {
  online: boolean;
  printerReady: boolean;
  printerLabel: string;
  printerCount: number;
  kitchenPrinterCount: number;
  barPrinterCount: number;
};

export function getPosHardwareSnapshot(online: boolean): PosHardwareSnapshot {
  const readiness = getPrinterReadiness(getCachedPrinterSetup());
  return {
    online,
    printerReady: readiness.receiptReady,
    printerLabel: readiness.label,
    printerCount: readiness.enabledCount,
    kitchenPrinterCount: readiness.kitchenCount,
    barPrinterCount: readiness.barCount,
  };
}
