"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { subscribeAppReleaseSettings } from "@/lib/app-release";
import { POS_CLIENT_BUILD, fetchPosServerBuild } from "@/lib/pos-app-update";
import { getPosDb } from "@/lib/pos-firebase";
import { isPosSafeToReload, POS_IDLE_BEFORE_RELOAD_MS, type PosSellBusyState } from "@/lib/pos-reload";

const POLL_MS = 30 * 1000;
const FORCE_POLL_MS = 15 * 1000;
const RETRY_MS = 5 * 1000;
const MIN_VISIBILITY_CHECK_MS = 60 * 1000;
const MIN_RELOAD_GAP_MS = 45 * 1000;
const RELOAD_BUILD_KEY = "telltea_pos_last_reload_build";

/**
 * POS auto-update — polls /pos-version.json and respects owner forceAppUpdate.
 * Throttled to avoid reload loops on Android (visibility / flaky network).
 */
export function PosUpdateWatcher({
  enabled,
  sellBusy,
  onReload,
}: {
  enabled: boolean;
  sellBusy: PosSellBusyState;
  onReload: () => void;
}) {
  const [forceMode, setForceMode] = useState(false);
  const [serverBuild, setServerBuild] = useState<number | null>(null);
  const [waiting, setWaiting] = useState(false);
  const lastInputAt = useRef(0);
  const lastVersionCheckAt = useRef(0);
  const lastReloadAt = useRef(0);
  const forceModeRef = useRef(forceMode);
  const reloadRequestedRef = useRef(false);

  const hasUpdate = serverBuild != null && serverBuild > POS_CLIENT_BUILD;
  const safe = isPosSafeToReload(sellBusy);

  useEffect(() => {
    forceModeRef.current = forceMode;
  }, [forceMode]);

  const checkVersion = useCallback(async () => {
    const build = await fetchPosServerBuild();
    if (build != null && build > POS_CLIENT_BUILD) {
      setServerBuild(build);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    function markInput() {
      lastInputAt.current = Date.now();
    }

    function onVisible() {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastVersionCheckAt.current < MIN_VISIBILITY_CHECK_MS) return;
      lastVersionCheckAt.current = now;
      void checkVersion();
    }

    document.addEventListener("input", markInput, true);
    document.addEventListener("change", markInput, true);
    document.addEventListener("pointerdown", markInput, true);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    lastVersionCheckAt.current = Date.now();
    void checkVersion();

    return () => {
      document.removeEventListener("input", markInput, true);
      document.removeEventListener("change", markInput, true);
      document.removeEventListener("pointerdown", markInput, true);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [checkVersion, enabled]);

  useEffect(() => {
    if (!enabled) return;
    return subscribeAppReleaseSettings(
      (settings) => {
        setForceMode(settings.forceAppUpdate || settings.forcePosAutoUpdate);
        if (settings.forceAppUpdate || settings.forcePosAutoUpdate) {
          void checkVersion();
        }
      },
      undefined,
      getPosDb(),
    );
  }, [checkVersion, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const interval = forceMode ? FORCE_POLL_MS : POLL_MS;
    const timer = setInterval(() => void checkVersion(), interval);
    return () => clearInterval(timer);
  }, [checkVersion, enabled, forceMode]);

  const tryReload = useCallback(() => {
    if (!hasUpdate || serverBuild == null) {
      setWaiting(false);
      reloadRequestedRef.current = false;
      return;
    }

    if (typeof sessionStorage !== "undefined") {
      const lastBuild = Number(sessionStorage.getItem(RELOAD_BUILD_KEY) || 0);
      if (lastBuild >= serverBuild) {
        setWaiting(false);
        reloadRequestedRef.current = false;
        return;
      }
    }

    const now = Date.now();
    if (reloadRequestedRef.current && now - lastReloadAt.current < MIN_RELOAD_GAP_MS) {
      return;
    }

    const force = forceModeRef.current;
    const idleLongEnough =
      force || Date.now() - lastInputAt.current >= POS_IDLE_BEFORE_RELOAD_MS;
    if (safe && idleLongEnough) {
      reloadRequestedRef.current = true;
      lastReloadAt.current = now;
      setWaiting(false);
      try {
        sessionStorage.setItem(RELOAD_BUILD_KEY, String(serverBuild));
      } catch {
        // ignore
      }
      onReload();
      return;
    }

    setWaiting(force);
  }, [hasUpdate, onReload, safe, serverBuild]);

  useEffect(() => {
    if (!enabled || !hasUpdate) {
      setWaiting(false);
      reloadRequestedRef.current = false;
      return;
    }

    tryReload();
    if (!forceMode) return;

    const timer = setInterval(tryReload, RETRY_MS);
    return () => clearInterval(timer);
  }, [enabled, forceMode, hasUpdate, safe, tryReload]);

  if (!enabled || !hasUpdate) return null;

  if (forceMode) {
    if (!waiting) return null;
    return (
      <div className="pos-update-banner pos-update-banner--force" role="status" aria-live="polite">
        <RefreshCw size={16} aria-hidden className="pos-update-banner-icon" />
        <span>กำลังอัปเดตเป็น POS {serverBuild} — รอตะกร้าว่าง</span>
      </div>
    );
  }

  return (
    <div className="pos-update-banner" role="status" aria-live="polite">
      <RefreshCw size={16} aria-hidden className="pos-update-banner-icon" />
      <span>มี POS {serverBuild} ใหม่</span>
      <button
        type="button"
        className="ghost-btn pos-update-banner-btn"
        disabled={!safe}
        onClick={onReload}
      >
        {safe ? "อัปเดต" : "รอตะกร้าว่าง"}
      </button>
    </div>
  );
}
