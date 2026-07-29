"use client";

import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { STAFF_PRESENCE_HEARTBEAT_MS, touchStaffPresence } from "@/lib/staff-presence";

/**
 * ปัก lastSeenAt ในตาราง staff ตอนเข้าใช้ + วนทุก ~10 นาทีขณะแท็บมองเห็น
 * ยังไม่เคยมีค่า → รอครั้งแรกที่ล็อกอิน/เปิดแอป
 */
export function StaffPresenceHeartbeat() {
  const { staff, status } = useAuth();

  useEffect(() => {
    if (status !== "ready" || !staff?.id) return;

    let cancelled = false;
    const beat = () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void touchStaffPresence(staff.id);
    };

    beat();
    const timer = window.setInterval(beat, STAFF_PRESENCE_HEARTBEAT_MS);

    const onVis = () => {
      if (document.visibilityState === "visible") beat();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, [staff?.id, status]);

  return null;
}
