/**
 * Detect Capacitor native shell vs browser / PWA.
 * Bridge hooks for reload / silent print land here in later phases.
 */
export function isPosNativeShell(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as Window & {
    Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
  };
  try {
    return w.Capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

export function posNativePlatform(): "android" | "ios" | "web" {
  if (typeof window === "undefined") return "web";
  const w = window as Window & {
    Capacitor?: { getPlatform?: () => string; isNativePlatform?: () => boolean };
  };
  if (!w.Capacitor?.isNativePlatform?.()) return "web";
  const p = w.Capacitor.getPlatform?.();
  if (p === "android" || p === "ios") return p;
  return "web";
}
