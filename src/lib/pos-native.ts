import { POS_NATIVE_SHELL_BUILD, type PosShellKind } from "./pos-native-version";

/**
 * Detect Capacitor native shell vs browser / PWA.
 * Bridge hooks for APK install / silent print land in later phases.
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

export function detectPosShellKind(): PosShellKind {
  if (isPosNativeShell()) return "native";
  if (typeof window === "undefined") return "browser";
  const standalone =
    window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone ? "pwa" : "browser";
}

export function getPosNativeShellBuild(): number {
  return isPosNativeShell() ? POS_NATIVE_SHELL_BUILD : 0;
}

export type PosNativeShellInfo = {
  shellKind: PosShellKind;
  nativeShellBuild: number;
  platform: "android" | "ios" | "web";
};

export function getPosNativeShellInfo(): PosNativeShellInfo {
  const kind = detectPosShellKind();
  return {
    shellKind: kind,
    nativeShellBuild: kind === "native" ? POS_NATIVE_SHELL_BUILD : 0,
    platform: posNativePlatform(),
  };
}
