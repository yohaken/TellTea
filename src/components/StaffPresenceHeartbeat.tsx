"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { STAFF_PRESENCE_HEARTBEAT_MS, touchStaffPresence } from "@/lib/staff-presence";

/** กันยิงถี่ตอนพิมพ์/สกอร์ล — ยังถี่พอให้เจ้าของเห็นเข้าหลังสุดตรงกับงานจริง */
const ACTIVITY_TOUCH_MIN_MS = 20_000;
/** หลังมี interaction — ปักต่อแม้แท็บ/คีย์บอร์ดรายงาน hidden (มือถือพบบ่อยตอนกรอกสต็อก) */
const RECENT_ACTIVITY_MS = 15 * 60_000;

/**
 * ปัก lastSeenAt ของบัญชีจริงตอนเข้าใช้ + ตอนมี interaction + วนเป็นระยะ
 * สำคัญ: อย่าพึ่งแค่ interval/visibility — พนักงานใส่สต็อกได้ทั้งที่ heartbeat เงียบ
 */
export function StaffPresenceHeartbeat() {
  const { realStaff, status } = useAuth();
  const staffId = realStaff?.id || "";
  const retryTimers = useRef<number[]>([]);
  const lastTouchAt = useRef(0);
  const lastActivityAt = useRef(Date.now());

  useEffect(() => {
    if (status !== "ready" || !staffId) return;

    let cancelled = false;
    const clearRetries = () => {
      for (const t of retryTimers.current) window.clearTimeout(t);
      retryTimers.current = [];
    };

    const beat = (opts?: { force?: boolean; ignoreVisibility?: boolean }) => {
      if (cancelled) return;
      const recentlyActive = Date.now() - lastActivityAt.current <= RECENT_ACTIVITY_MS;
      if (
        !opts?.ignoreVisibility &&
        !recentlyActive &&
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }
      const now = Date.now();
      if (!opts?.force && now - lastTouchAt.current < 5_000) return;
      lastTouchAt.current = now;
      void touchStaffPresence(staffId).then((ok) => {
        if (cancelled || ok) return;
        clearRetries();
        for (const delay of [2_000, 8_000, 20_000]) {
          retryTimers.current.push(
            window.setTimeout(() => {
              if (cancelled) return;
              void touchStaffPresence(staffId);
            }, delay),
          );
        }
      });
    };

    // ครั้งแรกหลัง ready — ไม่สน visibility (มือถือบางเครื่องรายงาน hidden ผิดจังหวะ)
    beat({ force: true, ignoreVisibility: true });
    const timer = window.setInterval(
      () => beat({ force: true, ignoreVisibility: true }),
      STAFF_PRESENCE_HEARTBEAT_MS,
    );

    const onVis = () => {
      if (document.visibilityState === "visible") {
        lastActivityAt.current = Date.now();
        beat({ force: true, ignoreVisibility: true });
      }
    };

    let activityTimer: number | null = null;
    const onActivity = () => {
      lastActivityAt.current = Date.now();
      if (activityTimer != null) return;
      activityTimer = window.setTimeout(() => {
        activityTimer = null;
        beat({ ignoreVisibility: true });
      }, ACTIVITY_TOUCH_MIN_MS);
    };

    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    window.addEventListener("pageshow", onVis);
    const activityEvents: Array<keyof WindowEventMap> = [
      "pointerdown",
      "keydown",
      "touchstart",
      "scroll",
      "input",
    ];
    for (const ev of activityEvents) {
      window.addEventListener(ev, onActivity, { passive: true });
    }

    return () => {
      cancelled = true;
      clearRetries();
      window.clearInterval(timer);
      if (activityTimer != null) window.clearTimeout(activityTimer);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
      window.removeEventListener("pageshow", onVis);
      for (const ev of activityEvents) {
        window.removeEventListener(ev, onActivity);
      }
    };
  }, [staffId, status]);

  return null;
}
