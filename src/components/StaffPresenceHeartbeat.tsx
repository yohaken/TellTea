"use client";

import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { STAFF_PRESENCE_HEARTBEAT_MS, touchStaffPresence } from "@/lib/staff-presence";

/** ทุกคนที่ล็อกอินแล้ว — ปัก lastSeenAt เป็นระยะ (เงียบ) */
export function StaffPresenceHeartbeat() {
  const { staff, status } = useAuth();

  useEffect(() => {
    if (status !== "ready" || !staff?.id) return;

    let cancelled = false;
    const beat = () => {
      if (cancelled || document.visibilityState === "hidden") return;
      void touchStaffPresence(staff.id);
    };

    beat();
    const timer = window.setInterval(beat, STAFF_PRESENCE_HEARTBEAT_MS);

    const onVis = () => {
      if (document.visibilityState === "visible") beat();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", beat);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", beat);
    };
  }, [staff?.id, status]);

  return null;
}
