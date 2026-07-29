"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import {
  STAFF_PRESENCE_HEARTBEAT_MS,
  STAFF_PRESENCE_IDLE_MS,
  touchStaffPresence,
} from "@/lib/staff-presence";

/**
 * ปัก lastSeenAt เฉพาะตอนแท็บมองเห็น + มีการใช้งานจริงไม่นานนี้
 * (ไม่นับแท็บเปิดทิ้งไว้เฉยๆ)
 */
export function StaffPresenceHeartbeat() {
  const { staff, status } = useAuth();
  const lastActiveRef = useRef(Date.now());

  useEffect(() => {
    if (status !== "ready" || !staff?.id) return;

    let cancelled = false;
    const markActive = () => {
      lastActiveRef.current = Date.now();
    };

    const beat = () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const idleFor = Date.now() - lastActiveRef.current;
      if (idleFor > STAFF_PRESENCE_IDLE_MS) return;
      void touchStaffPresence(staff.id);
    };

    markActive();
    beat();
    const timer = window.setInterval(beat, STAFF_PRESENCE_HEARTBEAT_MS);

    const onVis = () => {
      if (document.visibilityState === "visible") {
        markActive();
        beat();
      }
    };

    const activityEvents: Array<keyof WindowEventMap> = [
      "pointerdown",
      "keydown",
      "scroll",
      "touchstart",
      "mousemove",
    ];
    for (const ev of activityEvents) {
      window.addEventListener(ev, markActive, { passive: true });
    }
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
      for (const ev of activityEvents) {
        window.removeEventListener(ev, markActive);
      }
    };
  }, [staff?.id, status]);

  return null;
}
