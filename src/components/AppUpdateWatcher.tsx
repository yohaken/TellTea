"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { CLIENT_BUILD, fetchServerBuild, isUserBusyForReload } from "@/lib/app-update";

const POLL_MS = 2 * 60 * 1000;
const SNOOZE_MS = 30 * 60 * 1000;
const SNOOZE_KEY = "telltea-update-snooze-until";

/**
 * Poll /version.json and show a banner when a newer build is live.
 * User taps to reload when ready — no forced auto-refresh.
 */
export function AppUpdateWatcher() {
  const [serverBuild, setServerBuild] = useState<number | null>(null);
  const [snoozedUntil, setSnoozedUntil] = useState(0);

  const checkVersion = useCallback(async () => {
    const build = await fetchServerBuild();
    if (build != null && build > CLIENT_BUILD) {
      setServerBuild(build);
    }
  }, []);

  useEffect(() => {
    const stored = Number(sessionStorage.getItem(SNOOZE_KEY) || "0");
    if (stored > Date.now()) setSnoozedUntil(stored);

    void checkVersion();
    const pollTimer = setInterval(() => void checkVersion(), POLL_MS);
    return () => clearInterval(pollTimer);
  }, [checkVersion]);

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

  if (serverBuild == null || Date.now() < snoozedUntil) return null;

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
