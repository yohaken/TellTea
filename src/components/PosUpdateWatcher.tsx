"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { subscribeAppReleaseSettings } from "@/lib/app-release";
import { CLIENT_BUILD, fetchServerBuild } from "@/lib/app-update";
import { isPosSafeToReload, POS_IDLE_BEFORE_RELOAD_MS, type PosSellBusyState } from "@/lib/pos-reload";

const POLL_MS = 2 * 60 * 1000;
const FORCE_POLL_MS = 60 * 1000;
const RETRY_MS = 15 * 1000;

/**
 * POS auto-update — polls /version.json and respects owner forceAppUpdate.
 * Reload only when cart is empty and payment modal is closed.
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

  const hasUpdate = serverBuild != null && serverBuild > CLIENT_BUILD;
  const safe = isPosSafeToReload(sellBusy);

  const checkVersion = useCallback(async () => {
    const build = await fetchServerBuild();
    if (build != null && build > CLIENT_BUILD) {
      setServerBuild(build);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    function markInput() {
      lastInputAt.current = Date.now();
    }

    document.addEventListener("input", markInput, true);
    document.addEventListener("change", markInput, true);
    document.addEventListener("pointerdown", markInput, true);
    void checkVersion();

    return () => {
      document.removeEventListener("input", markInput, true);
      document.removeEventListener("change", markInput, true);
      document.removeEventListener("pointerdown", markInput, true);
    };
  }, [checkVersion, enabled]);

  useEffect(() => {
    if (!enabled) return;
    return subscribeAppReleaseSettings((settings) => {
      setForceMode(settings.forceAppUpdate);
    });
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const interval = forceMode ? FORCE_POLL_MS : POLL_MS;
    const timer = setInterval(() => void checkVersion(), interval);
    return () => clearInterval(timer);
  }, [checkVersion, enabled, forceMode]);

  const tryReload = useCallback(() => {
    if (!hasUpdate) {
      setWaiting(false);
      return;
    }

    const idleLongEnough = Date.now() - lastInputAt.current >= POS_IDLE_BEFORE_RELOAD_MS;
    if (safe && idleLongEnough) {
      setWaiting(false);
      onReload();
      return;
    }

    setWaiting(true);
  }, [hasUpdate, onReload, safe]);

  useEffect(() => {
    if (!enabled || !hasUpdate) {
      setWaiting(false);
      return;
    }

    if (!forceMode) {
      setWaiting(false);
      return;
    }

    tryReload();
    const timer = setInterval(tryReload, RETRY_MS);
    return () => clearInterval(timer);
  }, [enabled, forceMode, hasUpdate, safe, tryReload]);

  if (!enabled || !hasUpdate) return null;

  if (forceMode) {
    if (!waiting) return null;
    return (
      <div className="pos-update-banner pos-update-banner--force" role="status" aria-live="polite">
        <RefreshCw size={16} aria-hidden className="pos-update-banner-icon" />
        <span>กำลังอัปเดตเป็น v{serverBuild} — รอตะกร้าว่าง</span>
      </div>
    );
  }

  return (
    <div className="pos-update-banner" role="status" aria-live="polite">
      <RefreshCw size={16} aria-hidden className="pos-update-banner-icon" />
      <span>มี v{serverBuild} ใหม่</span>
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
