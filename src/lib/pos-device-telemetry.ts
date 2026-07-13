import { getPrinterReadiness } from "./pos-printer/router";
import { isPosStandaloneMode } from "./pos-install";

export type PosDeviceTelemetry = {
  deviceHint: string;
  printerLabel: string;
  printerReady: boolean;
  standalone: boolean;
  screenSize: string;
  platform: string;
};

/** แยกรุ่นเครื่องจาก user-agent — ใช้ดูจากหลังบ้านแทนการถ่ายรูปหน้าจอ */
export function parseDeviceHint(userAgent: string): string {
  const ua = userAgent.trim();
  if (!ua) return "ไม่ทราบ";

  const sunmi = ua.match(/\b(SUNMI[\w-]*)/i);
  if (sunmi) return sunmi[1];

  const imin = ua.match(/\b(iMin[\w-]*)/i);
  if (imin) return imin[1];

  const pax = ua.match(/\b(PAX[\w-]*)/i);
  if (pax) return pax[1];

  const androidModel = ua.match(/Android[^;]*;\s*([^)]+)\)/i);
  if (androidModel?.[1]) {
    const model = androidModel[1].trim();
    if (model && !/^Build\//i.test(model) && model !== "Linux") return model;
  }

  if (/iPad/i.test(ua)) return "iPad";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Macintosh/i.test(ua)) return "Mac";

  return ua.length > 72 ? `${ua.slice(0, 71)}…` : ua;
}

export function collectPosDeviceTelemetry(): PosDeviceTelemetry {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const readiness = getPrinterReadiness();
  const screenSize =
    typeof window !== "undefined"
      ? `${window.screen.width}×${window.screen.height}@${window.devicePixelRatio || 1}x`
      : "";

  return {
    deviceHint: parseDeviceHint(ua),
    printerLabel: readiness.label,
    printerReady: readiness.receiptReady,
    standalone: isPosStandaloneMode(),
    screenSize,
    platform: typeof navigator !== "undefined" ? navigator.platform || "" : "",
  };
}
