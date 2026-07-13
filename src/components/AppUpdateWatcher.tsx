"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { subscribeAppReleaseSettings } from "@/lib/app-release";
import { CLIENT_BUILD, fetchServerBuild, isUserBusyForReload } from "@/lib/app-update";

const POLL_MS = 2 * 60 * 1000;
const FORCE_POLL_MS = 60 * 1000;
const RETRY_MS = 30 * 1000;
const IDLE_AFTER_INPUT_MS = 45 * 1000;
const SNOOZE_MS = 30 * 60 * 1000;
const SNOOZE_KEY = "telltea-update-snooze-until";

/**
 * Poll /version.json for newer builds.
 * - Soft mode (default): banner + user taps to update
 * - Force mode (owner toggle): auto-reload when safe (defers during forms)
 */
export function AppUpdateWatcher() {
  const [forceMode, setForceMode] = useState(false);
  const [serverBuild, setServerBuild] = useState<number | null>(null);
  const [snoozedUntil, setSnoozedUntil] = useState(0);
  const [waitingToForce, setWaitingToForce] = useState(false);
  const lastInputAt = useRef(0);

  const hasUpdate = serverBuild != null && serverBuild > CLIENT_BUILD;

  const checkVersion = useCallback(async () => {
    const build = await fetchServerBuild();
    if (build != null && build > CLIENT_BUILD) {
      setServerBuild(build);
    }
  }, []);

  useEffect(() => {
    const stored = Number(sessionStorage.getItem(SNOOZE_KEY) || "0");
    if (stored > Date.now()) setSnoozedUntil(stored);

    function markInput() {
      lastInputAt.current = Date.now();
    }

    document.addEventListener("input", markInput, true);
    document.addEventListener("change", markInput, true);
    document.addEventListener("focusin", markInput, true);

    void checkVersion();

    return () => {
      document.removeEventListener("input", markInput, true);
      document.removeEventListener("change", markInput, true);
      document.removeEventListener("focusin", markInput, true);
    };
  }, [checkVersion]);

  useEffect(() => {
    return subscribeAppReleaseSettings((settings) => {
      setForceMode(settings.forceAppUpdate);
    });
  }, []);

  useEffect(() => {
    const interval = forceMode ? FORCE_POLL_MS : POLL_MS;
    const pollTimer = setInterval(() => void checkVersion(), interval);
    return () => clearInterval(pollTimer);
  }, [checkVersion, forceMode]);

  useEffect(() => {
    if (!forceMode || !hasUpdate) {
      setWaitingToForce(false);
      return;
    }

    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    function tryForceReload() {
      const idleLongEnough = Date.now() - lastInputAt.current >= IDLE_AFTER_INPUT_MS;
      if (!isUserBusyForReload() && idleLongEnough) {
        setWaitingToForce(false);
        window.location.reload();
        return;
      }

      setWaitingToForce(true);
      retryTimer = setTimeout(tryForceReload, RETRY_MS);
    }

    tryForceReload();

    return () => {
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [forceMode, hasUpdate, serverBuild]);

  function snooze() {
    const until = Date.now() + SNOOZE_MS;
    sessionStorage.setItem(SNOOZE_KEY, String(until));
    setSnoozedUntil(until);
  }

  function applyUpdate() {
    if (isUserBusyForReload()) {
      const ok = window.confirm(
        "กำลังกรอกข้อมูลอยู่ — อัปเดตตอนนี้จะรีเซ็ตหน้านี้\nต้องการอัปเดตเลยไหม?",
      );
      if (!ok) return;
    }
    window.location.reload();
  }

  if (!hasUpdate) return null;

  if (forceMode) {
    if (!waitingToForce) return null;

    return (
      <div className="app-update-banner app-update-banner--force" role="status" aria-live="polite">
        <RefreshCw size={18} aria-hidden className="app-update-banner-icon" />
        <div className="app-update-banner-copy">
          <strong>กำลังอัปเดตเป็น v{serverBuild}</strong>
          <span>เจ้าของเปิดโหมดบังคับ — รอให้บันทึก/กรอกเสร็จก่อนรีเฟรชอัตโนมัติ</span>
        </div>
      </div>
    );
  }

  if (Date.now() < snoozedUntil) return null;

  return (
    <div className="app-update-banner" role="status" aria-live="polite">
      <RefreshCw size={18} aria-hidden className="app-update-banner-icon" />
      <div className="app-update-banner-copy">
        <strong>มีเวอร์ชันใหม่ v{serverBuild}</strong>
        <span>คุณใช้ v{CLIENT_BUILD} — กดอัปเดตเมื่อพร้อม</span>
      </div>
      <div className="app-update-banner-actions">
        <button type="button" className="primary-btn app-update-banner-btn" onClick={applyUpdate}>
          อัปเดตเลย
        </button>
        <button type="button" className="ghost-btn app-update-banner-btn" onClick={snooze}>
          ภายหลัง
        </button>
      </div>
    </div>
  );
}
