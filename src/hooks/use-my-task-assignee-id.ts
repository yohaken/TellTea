"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { resolveAndHealTaskAssignee } from "@/lib/task-assignee";

/**
 * employeeId สำหรับงานมอบหมายมุมพนักงาน
 * โหลด roster → resolve ลิงก์ canonical → heal staff.employeeId ถ้าค้าง
 */
export function useMyTaskAssigneeId() {
  const { staff, status, refreshStaff, isPermPreview } = useAuth();
  const [employeeId, setEmployeeId] = useState("");
  const [ready, setReady] = useState(false);
  const healKeyRef = useRef("");

  useEffect(() => {
    if (status !== "ready" || !staff) {
      setEmployeeId("");
      setReady(status !== "loading");
      return;
    }
    if (staff.role === "owner") {
      setEmployeeId(staff.employeeId || "");
      setReady(true);
      return;
    }

    let cancelled = false;
    setReady(false);
    void resolveAndHealTaskAssignee(staff, {
      // พรีวิวห้ามเขียนทับโปรไฟล์จริง
      heal: !isPermPreview,
    })
      .then(async (res) => {
        if (cancelled) return;
        setEmployeeId(res.employeeId);
        setReady(true);
        if (res.healed) {
          const key = `${staff.id}:${res.employeeId}`;
          if (healKeyRef.current !== key) {
            healKeyRef.current = key;
            try {
              await refreshStaff();
            } catch {
              /* ignore */
            }
          }
        }
      })
      .catch(() => {
        if (cancelled) return;
        setEmployeeId(staff.employeeId || "");
        setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [
    status,
    staff,
    staff?.id,
    staff?.employeeId,
    staff?.email,
    staff?.phone,
    staff?.displayName,
    staff?.role,
    isPermPreview,
    refreshStaff,
  ]);

  return { employeeId, ready };
}
