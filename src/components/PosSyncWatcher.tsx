"use client";

import { useEffect, useRef } from "react";
import type { PosSyncSnapshot } from "@/lib/pos-sync";
import { refreshPosSyncSnapshot, runPosSyncFlush, subscribePosSync } from "@/lib/pos-sync";

const FLUSH_MS = 12 * 1000;

/** Background sync for offline sale outbox — flush when online. */
export function PosSyncWatcher({
  enabled,
  onSyncChange,
}: {
  enabled: boolean;
  onSyncChange?: (snap: PosSyncSnapshot) => void;
}) {
  const onSyncChangeRef = useRef(onSyncChange);
  onSyncChangeRef.current = onSyncChange;

  useEffect(() => {
    if (!enabled) return;

    const unsub = subscribePosSync((snap) => {
      onSyncChangeRef.current?.(snap);
    });

    void refreshPosSyncSnapshot().then((snap) => {
      if (snap.pendingCount > 0) void runPosSyncFlush();
    });

    function onOnline() {
      void runPosSyncFlush();
    }

    window.addEventListener("online", onOnline);
    const timer = window.setInterval(() => void runPosSyncFlush(), FLUSH_MS);

    return () => {
      unsub();
      window.removeEventListener("online", onOnline);
      window.clearInterval(timer);
    };
  }, [enabled]);

  return null;
}
