"use client";

import { useEffect } from "react";
import { CLIENT_BUILD, fetchServerBuild, isUserBusyForReload } from "@/lib/app-update";

const POLL_MS = 2 * 60 * 1000;
const RETRY_MS = 30 * 1000;
const IDLE_AFTER_INPUT_MS = 45 * 1000;

/**
 * Silently reload when a newer build is on the server.
 * Defers while a form/modal is active so in-progress entries are not lost.
 */
export function AppUpdateWatcher() {
  useEffect(() => {
    let pendingReload = false;
    let lastInputAt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    function clearRetry() {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = undefined;
      }
    }

    function scheduleRetry() {
      clearRetry();
      retryTimer = setTimeout(() => void tryReload(), RETRY_MS);
    }

    function tryReload() {
      if (!pendingReload) return;

      const idleLongEnough = Date.now() - lastInputAt >= IDLE_AFTER_INPUT_MS;
      if (!isUserBusyForReload() && idleLongEnough) {
        window.location.reload();
        return;
      }

      scheduleRetry();
    }

    function markInput() {
      lastInputAt = Date.now();
    }

    async function checkVersion() {
      const serverBuild = await fetchServerBuild();
      if (serverBuild == null || serverBuild <= CLIENT_BUILD) return;

      pendingReload = true;
      tryReload();
    }

    document.addEventListener("input", markInput, true);
    document.addEventListener("change", markInput, true);
    document.addEventListener("focusin", markInput, true);

    void checkVersion();
    const pollTimer = setInterval(() => void checkVersion(), POLL_MS);

    return () => {
      document.removeEventListener("input", markInput, true);
      document.removeEventListener("change", markInput, true);
      document.removeEventListener("focusin", markInput, true);
      if (pollTimer) clearInterval(pollTimer);
      clearRetry();
    };
  }, []);

  return null;
}
