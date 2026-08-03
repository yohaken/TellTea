"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, ListTodo, X } from "lucide-react";
import { useMyTaskAssigneeId } from "@/hooks/use-my-task-assignee-id";
import { useAuth } from "@/lib/auth";
import {
  subscribeTaskOccurrencesForAssignee,
  taskOccurrenceSinceMs,
} from "@/lib/task-occurrences";
import {
  STAFF_TASK_NUDGE_DISMISS_KEY,
  actionableStaffTaskNudges,
  staffTaskNudgeFingerprint,
  summarizeStaffTaskNudges,
  type StaffTaskNudgeItem,
} from "@/lib/staff-task-nudge";
import { formatDateShortBe } from "@/lib/utils";

function readDismissed(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(STAFF_TASK_NUDGE_DISMISS_KEY);
}

function writeDismissed(fp: string) {
  window.sessionStorage.setItem(STAFF_TASK_NUDGE_DISMISS_KEY, fp);
}

/**
 * งานค้างกึ่งแจ้งเตือน — พนักงานรายคน
 * เข้าแอป: ป๊อปเบาๆ (ปิดได้รอบนี้) · แถบล่างคงที่จนกว่างานค้างหมด
 */
export function StaffTaskNudge() {
  const { staff, status } = useAuth();
  const isOwner = staff?.role === "owner";
  const { employeeId: myEmployeeId, ready: assigneeReady } = useMyTaskAssigneeId();
  const ready =
    status === "ready" && !!staff && !isOwner && assigneeReady && !!myEmployeeId;

  const [items, setItems] = useState<StaffTaskNudgeItem[]>([]);
  const [popupOpen, setPopupOpen] = useState(false);
  const [stripExpanded, setStripExpanded] = useState(false);

  useEffect(() => {
    if (!ready) {
      setItems([]);
      return;
    }
    return subscribeTaskOccurrencesForAssignee(
      myEmployeeId,
      (rows) => setItems(actionableStaffTaskNudges(rows)),
      () => setItems([]),
      { since: taskOccurrenceSinceMs() },
    );
  }, [ready, myEmployeeId]);

  const fingerprint = useMemo(() => staffTaskNudgeFingerprint(items), [items]);
  const summary = useMemo(() => summarizeStaffTaskNudges(items), [items]);

  useEffect(() => {
    if (!items.length || !fingerprint) {
      setPopupOpen(false);
      return;
    }
    if (readDismissed() === fingerprint) {
      setPopupOpen(false);
      return;
    }
    setPopupOpen(true);
  }, [items.length, fingerprint]);

  if (!ready || !items.length) return null;

  function dismissPopup() {
    writeDismissed(fingerprint);
    setPopupOpen(false);
  }

  return (
    <>
      {popupOpen ? (
        <div className="staff-task-nudge-float" role="region" aria-label="งานค้าง">
          <div className="staff-task-nudge-float-card">
            <div className="staff-task-nudge-float-top">
              <p className="staff-task-nudge-kicker">
                <ListTodo size={13} aria-hidden />
                งานค้าง {summary.total}
                {summary.deadline ? (
                  <span className="staff-task-nudge-pill is-deadline">
                    กำหนด {summary.deadline}
                  </span>
                ) : null}
                {summary.waiting ? (
                  <span className="staff-task-nudge-pill is-waiting">
                    รออยู่ {summary.waiting}
                  </span>
                ) : null}
                {summary.soft ? (
                  <span className="staff-task-nudge-pill is-soft">เบา {summary.soft}</span>
                ) : null}
              </p>
              <button
                type="button"
                className="staff-task-nudge-close"
                onClick={dismissPopup}
                aria-label="ปิดการแจ้งเตือน"
              >
                <X size={15} aria-hidden />
              </button>
            </div>
            <p className="staff-task-nudge-headline">{summary.headline}</p>
            <div className="staff-task-nudge-float-actions">
              <button
                type="button"
                className="ghost-btn staff-task-nudge-btn"
                onClick={dismissPopup}
              >
                ปิด
              </button>
              <Link
                href="/tasks/"
                className="primary-btn staff-task-nudge-btn"
                onClick={dismissPopup}
              >
                ไปทำ
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      <div
        className={`staff-task-nudge-strip${stripExpanded ? " is-open" : ""}`}
        role="region"
        aria-label="แถบงานค้าง"
      >
        <button
          type="button"
          className="staff-task-nudge-strip-main"
          aria-expanded={stripExpanded}
          onClick={() => setStripExpanded((v) => !v)}
        >
          <ListTodo size={14} aria-hidden />
          <span className="staff-task-nudge-strip-text">
            งานค้าง {summary.total}
            {summary.headline ? ` · ${summary.headline}` : ""}
          </span>
          {stripExpanded ? (
            <ChevronDown size={14} aria-hidden />
          ) : (
            <ChevronUp size={14} aria-hidden />
          )}
        </button>
        {stripExpanded ? (
          <ul className="staff-task-nudge-list">
            {items.slice(0, 6).map((item) => (
              <li key={item.id}>
                <span
                  className={`staff-task-nudge-kind is-${
                    item.status === "waiting" ? "waiting" : item.nudgeKind
                  }`}
                  title={
                    item.status === "waiting"
                      ? "รออยู่"
                      : item.nudgeKind === "deadline"
                        ? "มีกำหนด"
                        : "แจ้งเบา"
                  }
                >
                  {item.status === "waiting"
                    ? "รอ"
                    : item.nudgeKind === "deadline"
                      ? "กำหนด"
                      : "เบา"}
                </span>
                <span className="staff-task-nudge-list-title">{item.title}</span>
                {item.nudgeKind === "deadline" && item.dueDate ? (
                  <span className="muted staff-task-nudge-list-due">
                    {formatDateShortBe(item.dueDate)}
                  </span>
                ) : null}
              </li>
            ))}
            <li className="staff-task-nudge-list-foot">
              <Link href="/tasks/" className="staff-task-nudge-link">
                เปิดหน้ารายการงาน
              </Link>
            </li>
          </ul>
        ) : null}
      </div>
    </>
  );
}
