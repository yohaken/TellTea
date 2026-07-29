"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import {
  STAFF_PRESENCE_AGE_TICK_MS,
  buildStaffPresenceItems,
  formatPresenceAge,
  subscribeEmployeesForPresence,
  subscribeStaffForPresence,
  type StaffPresenceItem,
} from "@/lib/staff-presence";
import type { Employee } from "@/lib/employees";
import type { StaffMember } from "@/lib/types";

/**
 * ไอคอนลอยขวาบน — เฉพาะเจ้าของ · แสดงพนักงานทุกคน
 * ป้ายเวลาจาก lastSeenAt ในตาราง staff (ยังไม่มี = —)
 */
export function StaffPresenceDock() {
  const { staff } = useAuth();
  const isOwner = staff?.role === "owner";
  const [members, setMembers] = useState<StaffMember[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isOwner) return;
    const unsubStaff = subscribeStaffForPresence(setMembers);
    const unsubEmp = subscribeEmployeesForPresence(setEmployees);

    const refreshNow = () => setNow(Date.now());
    refreshNow();

    let timer: number | null = null;
    const startTick = () => {
      if (timer != null) window.clearInterval(timer);
      timer = window.setInterval(refreshNow, STAFF_PRESENCE_AGE_TICK_MS);
    };
    const stopTick = () => {
      if (timer != null) {
        window.clearInterval(timer);
        timer = null;
      }
    };

    const onVis = () => {
      if (document.visibilityState === "visible") {
        refreshNow();
        startTick();
      } else {
        stopTick();
      }
    };

    if (document.visibilityState === "visible") startTick();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", refreshNow);
    window.addEventListener("pageshow", refreshNow);

    return () => {
      unsubStaff();
      unsubEmp();
      stopTick();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", refreshNow);
      window.removeEventListener("pageshow", refreshNow);
    };
  }, [isOwner]);

  const items = useMemo(
    () => buildStaffPresenceItems(members, employees, now),
    [members, employees, now],
  );

  if (!isOwner || items.length === 0) return null;

  return (
    <div className="staff-presence-dock" aria-label="พนักงานทั้งหมด" title="พนักงานทั้งหมด · เข้าใช้ล่าสุด">
      <ul className="staff-presence-list">
        {items.map((item) => (
          <PresenceChip key={item.staffId} item={item} now={now} />
        ))}
      </ul>
    </div>
  );
}

function PresenceChip({ item, now }: { item: StaffPresenceItem; now: number }) {
  const age = formatPresenceAge(item.lastSeenAt, now);
  const hasSeen = item.lastSeenAt > 0;
  return (
    <li
      className={`staff-presence-chip${item.online ? " is-online" : ""}${!hasSeen ? " is-waiting" : ""}`}
      title={
        hasSeen
          ? `${item.fullName} · เข้าหลังสุด ${age}`
          : `${item.fullName} · ยังไม่เคยเข้า (รอระบบบันทึก)`
      }
    >
      <span className="staff-presence-name">{item.label}</span>
      <span className="staff-presence-age">{age}</span>
    </li>
  );
}
