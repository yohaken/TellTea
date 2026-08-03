"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import {
  STAFF_PRESENCE_HEARTBEAT_MS,
  STAFF_PRESENCE_WARMUP_MS,
  touchStaffPresence,
} from "@/lib/staff-presence";

/** ช่วงอุ่นเครื่องหลังเปิดหน้า — ปักถี่ๆ ให้เจ้าของเห็นทันที */
const WARMUP_FOR_MS = 3 * 60_000;

/**
 * Presence มาตรฐาน: เปิดหน้าเว็บ / เปลี่ยนหน้า / โฟกัสกลับ → ปัก lastSeenAt
 * ไม่ผูกกับงานเฉพาะ (สต็อก/OT) — แค่เข้าใช้งานหลังร้านก็รู้
 */
export function StaffPresenceHeartbeat() {
  const { realStaff, status } = useAuth();
  const pathname = usePathname() || "";
  const staffId = realStaff?.id || "";
  const retryTimers = useRef<number[]>([]);
  const lastTouchAt = useRef(0);

  useEffect(() => {
    if (status !== "ready" || !staffId) return;

    let cancelled = false;
    const clearRetries = () => {
      for (const t of retryTimers.current) window.clearTimeout(t);
      retryTimers.current = [];
    };

    const beat = (opts?: { force?: boolean }) => {
      if (cancelled) return;
      const now = Date.now();
      if (!opts?.force && now - lastTouchAt.current < 5_000) return;
      lastTouchAt.current = now;
      void touchStaffPresence(staffId).then((ok) => {
        if (cancelled || ok) return;
        clearRetries();
        for (const delay of [1_500, 5_000, 15_000]) {
          retryTimers.current.push(
            window.setTimeout(() => {
              if (cancelled) return;
              void touchStaffPresence(staffId);
            }, delay),
          );
        }
      });
    };

    // เปิดหน้า / พร้อมใช้งาน → ปักทันที
    beat({ force: true });

    const warmupTimer = window.setInterval(() => beat({ force: true }), STAFF_PRESENCE_WARMUP_MS);
    let steadyTimer: number | null = null;
    const switchTimer = window.setTimeout(() => {
      window.clearInterval(warmupTimer);
      steadyTimer = window.setInterval(() => beat({ force: true }), STAFF_PRESENCE_HEARTBEAT_MS);
    }, WARMUP_FOR_MS);

    const onVis = () => {
      if (document.visibilityState === "visible") beat({ force: true });
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    window.addEventListener("pageshow", onVis);

    return () => {
      cancelled = true;
      clearRetries();
      window.clearInterval(warmupTimer);
      window.clearTimeout(switchTimer);
      if (steadyTimer != null) window.clearInterval(steadyTimer);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
      window.removeEventListener("pageshow", onVis);
    };
  }, [staffId, status]);

  // เปลี่ยนหน้าในแอป = ยังใช้งานอยู่ → ปักอีกครั้ง
  useEffect(() => {
    if (status !== "ready" || !staffId || !pathname) return;
    void touchStaffPresence(staffId);
  }, [pathname, staffId, status]);

  return null;
}
