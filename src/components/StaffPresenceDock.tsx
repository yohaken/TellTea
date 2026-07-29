"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import {
  buildStaffPresenceItems,
  formatPresenceAge,
  subscribeEmployeesForPresence,
  subscribeStaffForPresence,
  type StaffPresenceItem,
} from "@/lib/staff-presence";
import type { Employee } from "@/lib/employees";
import type { StaffMember } from "@/lib/types";

/**
 * ไอคอนลอยขวาบน — เฉพาะเจ้าของ
 * แสดงใครอยู่ในระบบ + ป้ายเข้าหลังสุด (ชม./นาที)
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
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      unsubStaff();
      unsubEmp();
      window.clearInterval(tick);
    };
  }, [isOwner]);

  const items = useMemo(
    () => buildStaffPresenceItems(members, employees, now),
    [members, employees, now],
  );

  if (!isOwner || items.length === 0) return null;

  return (
    <div className="staff-presence-dock" aria-label="พนักงานในระบบ" title="พนักงานที่เข้าใช้ล่าสุด">
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
  return (
    <li
      className={`staff-presence-chip${item.online ? " is-online" : ""}`}
      title={`${item.fullName} · เข้าหลังสุด ${age}`}
    >
      <span className="staff-presence-name">{item.label}</span>
      <span className="staff-presence-age">{age}</span>
    </li>
  );
}
