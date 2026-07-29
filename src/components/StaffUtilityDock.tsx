"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { Sparkles, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { StaffUtilityPanel } from "@/components/StaffUtilityPanel";
import { staffUtilityAttentionCount } from "@/lib/staff-utility";
import {
  subscribeTaskOccurrencesForAssignee,
  taskOccurrenceSinceMs,
} from "@/lib/task-occurrences";
import { filterOccurrencesByTab } from "@/lib/task-weekly-logic";
import { cn } from "@/lib/utils";

/**
 * ไอคอนยูทิลิตี้ซ้ายกลางจอ — เฉพาะพนักงาน (ไม่โชว์มุมเจ้าของ)
 * กดปิดแผง = ปิดทันที · เจ้าของใช้หน้าโมดูล `/utility/` แทน
 */
export function StaffUtilityDock() {
  const pathname = usePathname();
  const { staff, status } = useAuth();
  const isOwner = staff?.role === "owner";
  const [open, setOpen] = useState(false);
  const [pendingTasks, setPendingTasks] = useState(0);

  const ready = status === "ready" && !!staff && !isOwner;
  const myEmployeeId = staff?.employeeId || "";
  useBodyScrollLock(open);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!ready || !myEmployeeId) {
      setPendingTasks(0);
      return;
    }
    return subscribeTaskOccurrencesForAssignee(
      myEmployeeId,
      (rows) => {
        setPendingTasks(filterOccurrencesByTab(rows, "thisWeek").length);
      },
      () => setPendingTasks(0),
      { since: taskOccurrenceSinceMs() },
    );
  }, [ready, myEmployeeId]);

  const attention = useMemo(
    () =>
      staffUtilityAttentionCount({
        pendingTaskCount: pendingTasks,
        pendingSuggestionCount: 0,
      }),
    [pendingTasks],
  );

  function closePanel() {
    setOpen(false);
  }

  if (!ready) return null;
  if (pathname.startsWith("/pos")) return null;
  if (pathname.startsWith("/utility")) return null;

  return (
    <>
      <button
        type="button"
        className={cn("staff-utility-fab", attention > 0 && "is-attention")}
        aria-label={
          attention > 0
            ? `ยูทิลิตี้ · มี ${attention} รายการที่ต้องดู`
            : "ยูทิลิตี้ · ข้อเสนอและงาน"
        }
        title="ข้อเสนอ · งาน"
        onClick={() => setOpen(true)}
      >
        <Sparkles size={18} strokeWidth={2.25} aria-hidden />
        {attention > 0 ? (
          <span className="staff-utility-fab-badge" aria-hidden>
            {attention > 9 ? "9+" : attention}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          className="modal-backdrop staff-utility-backdrop"
          role="presentation"
          onClick={closePanel}
        >
          <div
            className="modal-card staff-utility-panel"
            role="dialog"
            aria-modal="true"
            aria-label="ยูทิลิตี้พนักงาน"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="staff-utility-head">
              <div>
                <h2>ยูทิลิตี้</h2>
                <p className="muted">ของเล็กๆ · ไม่แย่งแถบล่าง</p>
              </div>
              <button
                type="button"
                className="ghost-btn icon-btn"
                aria-label="ปิด"
                onClick={closePanel}
              >
                <X size={18} />
              </button>
            </header>

            <StaffUtilityPanel />
          </div>
        </div>
      ) : null}
    </>
  );
}
