/**
 * เวอร์ชันเปลือก Native (APK Capacitor) — แยกจาก POS_BUILD ของเว็บใน WebView
 * Bump เมื่อ ship APK ใหม่เท่านั้น
 */
export const POS_NATIVE_SHELL_BUILD = 2;

export type PosShellKind = "native" | "pwa" | "browser";

/** สถานะอัปเดต APK ที่รายงานเข้าหลังบ้าน */
export type PosNativeUpdateStatus =
  | "idle"
  | "available"
  | "downloading"
  | "installing"
  | "ready"
  | "failed";

export const POS_NATIVE_UPDATE_STATUS_LABEL: Record<PosNativeUpdateStatus, string> = {
  idle: "ล่าสุดแล้ว",
  available: "มีเวอร์ชันใหม่",
  downloading: "กำลังดาวน์โหลด",
  installing: "กำลังติดตั้ง",
  ready: "พร้อมเปิดใหม่",
  failed: "อัปเดตล้มเหลว",
};
