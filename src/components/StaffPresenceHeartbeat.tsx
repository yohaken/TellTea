"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { STAFF_PRESENCE_HEARTBEAT_MS, touchStaffPresence } from "@/lib/staff-presence";

/**
 * ปัก lastSeenAt ในตาราง staff ของบัญชีจริงตอนเข้าใช้ + วนขณะแท็บมองเห็น
 * ใช้ realStaff เสมอ — ห้ามใช้ staff จากพรีวิว (จะไปเขียน lastSeenAt คนอื่น / โดน rules ปฏิเสธ)
 */
export function StaffPresenceHeartbeat() {
  const { realStaff, status } = useAuth();
  const staffId = realStaff?.id || "";
  const retryTimers = useRef<number[]>([]);

  useEffect(() => {
    if (status !== "ready" || !staffId) return;

    let cancelled = false;
    const clearRetries = () => {
      for (const t of retryTimers.current) window.clearTimeout(t);
      retryTimers.current = [];
    };

    const beat = () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void touchStaffPresence(staffId).then((ok) => {
        if (cancelled || ok) return;
        // เขียนไม่ติด (token ยังไม่พร้อม / เน็ตสะดุด) — ลองใหม่เร็วๆ อย่ารอรอบ 2 นาที
        clearRetries();
        for (const delay of [3_000, 12_000, 30_000]) {
          retryTimers.current.push(
            window.setTimeout(() => {
              if (cancelled) return;
              if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
              void touchStaffPresence(staffId);
            }, delay),
          );
        }
      });
    };

    beat();
    const timer = window.setInterval(beat, STAFF_PRESENCE_HEARTBEAT_MS);

    const onVis = () => {
      if (document.visibilityState === "visible") beat();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    window.addEventListener("pageshow", onVis);

    return () => {
      cancelled = true;
      clearRetries();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
      window.removeEventListener("pageshow", onVis);
    };
  }, [staffId, status]);

  return null;
}
