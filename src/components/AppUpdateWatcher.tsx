"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { DEV_FORCE_IMMEDIATE_UPDATE, subscribeAppReleaseSettings } from "@/lib/app-release";
import { CLIENT_BUILD, fetchServerBuild, isUserBusyForReload } from "@/lib/app-update";
import { hardReloadWithCacheBust } from "@/lib/hard-reload";

const POLL_MS = 30 * 1000;
const FORCE_POLL_MS = 12 * 1000;
const RETRY_MS = 15 * 1000;
/** โหมดบังคับ — รอ idle สั้น */
const FORCE_IDLE_AFTER_INPUT_MS = 20 * 1000;
/** โหมดปกติ — ว่างนานพอแล้วค่อยรีโหลดเอง (แก้แท็บค้างเวอร์ชันเก่า) */
const SOFT_IDLE_AFTER_INPUT_MS = 90 * 1000;
const MIN_VISIBILITY_CHECK_MS = 15 * 1000;
const SNOOZE_MS = 30 * 60 * 1000;
const SNOOZE_KEY = "telltea-update-snooze-until";

/**
 * Poll /version.json for newer builds.
 * Re-check on tab focus/visibility (same idea as POS sync pulse) so BO
 * does not sit on a stale build for minutes.
 * - โหมดปกติ: โชว์แบนเนอร์ + รีโหลดอัตโนมัติเมื่อ idle 90 วินาที (ไม่ snooze)
 * - force / DEV: รีโหลดเมื่อว่างเร็วขึ้น
 */
export function AppUpdateWatcher() {
  const [ownerForce, setOwnerForce] = useState(false);
  const [serverBuild, setServerBuild] = useState<number | null>(null);
  const [snoozedUntil, setSnoozedUntil] = useState(0);
  const [waitingToForce, setWaitingToForce] = useState(false);
  const [softAutoPending, setSoftAutoPending] = useState(false);
  const lastInputAt = useRef(0);
  const lastVersionCheckAt = useRef(0);

  const forceMode = DEV_FORCE_IMMEDIATE_UPDATE || ownerForce;
  const hasUpdate = serverBuild != null && serverBuild > CLIENT_BUILD;
  const snoozed = Date.now() < snoozedUntil;

  const checkVersion = useCallback(async () => {
    lastVersionCheckAt.current = Date.now();
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

    function onVisible() {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastVersionCheckAt.current < MIN_VISIBILITY_CHECK_MS) return;
      void checkVersion();
    }

    document.addEventListener("input", markInput, true);
    document.addEventListener("change", markInput, true);
    document.addEventListener("focusin", markInput, true);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    void checkVersion();

    return () => {
      document.removeEventListener("input", markInput, true);
      document.removeEventListener("change", markInput, true);
      document.removeEventListener("focusin", markInput, true);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [checkVersion]);

  useEffect(() => {
    return subscribeAppReleaseSettings((settings) => {
      setOwnerForce(settings.forceAppUpdate);
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
      const idleLongEnough =
        DEV_FORCE_IMMEDIATE_UPDATE ||
        Date.now() - lastInputAt.current >= FORCE_IDLE_AFTER_INPUT_MS;
      if (!isUserBusyForReload() && idleLongEnough) {
        setWaitingToForce(false);
        hardReloadWithCacheBust("app-update");
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

  /** When snooze expires, re-render so banner + soft auto resume without waiting for poll. */
  useEffect(() => {
    if (!snoozedUntil || Date.now() >= snoozedUntil) return;
    const ms = snoozedUntil - Date.now() + 50;
    const timer = window.setTimeout(() => {
      setSnoozedUntil((until) => (Date.now() >= until ? 0 : until));
      try {
        const stored = Number(sessionStorage.getItem(SNOOZE_KEY) || "0");
        if (stored && Date.now() >= stored) sessionStorage.removeItem(SNOOZE_KEY);
      } catch {
        /* ignore */
      }
    }, ms);
    return () => clearTimeout(timer);
  }, [snoozedUntil]);

  /** Soft auto-reload: newer build + not snoozed + idle 90s → hard reload */
  useEffect(() => {
    if (forceMode || !hasUpdate) {
      setSoftAutoPending(false);
      return;
    }

    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    function trySoftReload() {
      if (Date.now() < snoozedUntil) {
        setSoftAutoPending(false);
        retryTimer = setTimeout(
          trySoftReload,
          Math.max(50, snoozedUntil - Date.now() + 50),
        );
        return;
      }
      const idleLongEnough =
        Date.now() - lastInputAt.current >= SOFT_IDLE_AFTER_INPUT_MS;
      if (!isUserBusyForReload() && idleLongEnough) {
        setSoftAutoPending(false);
        hardReloadWithCacheBust("app-update-soft");
        return;
      }
      setSoftAutoPending(true);
      retryTimer = setTimeout(trySoftReload, RETRY_MS);
    }

    trySoftReload();

    return () => {
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [forceMode, hasUpdate, serverBuild, snoozedUntil]);

  function snooze() {
    const until = Date.now() + SNOOZE_MS;
    sessionStorage.setItem(SNOOZE_KEY, String(until));
    setSnoozedUntil(until);
    setSoftAutoPending(false);
  }

  function applyUpdate() {
    if (isUserBusyForReload()) {
      const ok = window.confirm(
        "กำลังกรอกข้อมูลอยู่ — อัปเดตตอนนี้จะรีเซ็ตหน้านี้\nต้องการอัปเดตเลยไหม?",
      );
      if (!ok) return;
    }
    hardReloadWithCacheBust("app-update-manual");
  }

  if (!hasUpdate) return null;

  if (forceMode) {
    if (!waitingToForce) return null;

    return (
      <div className="app-update-banner app-update-banner--force" role="status" aria-live="polite">
        <RefreshCw size={18} aria-hidden className="app-update-banner-icon" />
        <div className="app-update-banner-copy">
          <strong>กำลังอัปเดตเป็น v{serverBuild}</strong>
          <span>โหมดพัฒนา — รอให้บันทึก/กรอกเสร็จก่อนรีเฟรชอัตโนมัติ</span>
        </div>
      </div>
    );
  }

  if (snoozed) return null;

  return (
    <div className="app-update-banner" role="status" aria-live="polite">
      <RefreshCw size={18} aria-hidden className="app-update-banner-icon" />
      <div className="app-update-banner-copy">
        <strong>มีเวอร์ชันใหม่ v{serverBuild}</strong>
        <span>
          คุณใช้ v{CLIENT_BUILD}
          {softAutoPending
            ? " — จะรีเฟรชเองเมื่อว่างกรอก (หรือกดอัปเดตเลย)"
            : " — กดอัปเดตเมื่อพร้อม"}
        </span>
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
