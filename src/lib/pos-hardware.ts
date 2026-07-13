export type PosHardwareSnapshot = {
  online: boolean;
  printerReady: boolean;
  printerLabel: string;
};

export function getPosHardwareSnapshot(online: boolean): PosHardwareSnapshot {
  const printerReady = typeof window !== "undefined" && typeof window.print === "function";
  return {
    online,
    printerReady,
    printerLabel: printerReady ? "พิมพ์ได้" : "ไม่มีพิมพ์",
  };
}
