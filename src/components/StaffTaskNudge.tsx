"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Camera, Check, ChevronDown, ChevronUp, ListTodo, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  reportTaskNotifyAck,
  subscribeTaskOccurrencesForAssignee,
  taskOccurrenceSinceMs,
} from "@/lib/task-occurrences";
import {
  STAFF_TASK_NUDGE_DISMISS_KEY,
  STAFF_WORK_NUDGE_DISMISS_KEY,
  acknowledgeNotifyToday,
  acknowledgeNotifyTodayMany,
  actionableStaffTaskNudges,
  actionableStaffWorkItems,
  staffTaskNudgeFingerprint,
  staffWorkNudgeFingerprint,
  summarizeStaffTaskNudges,
  summarizeStaffWorkNudges,
} from "@/lib/staff-task-nudge";
import type { TaskOccurrence } from "@/lib/task-types";
import { formatDateShortBe } from "@/lib/utils";

function readKey(key: string): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(key);
}

function writeKey(key: string, value: string) {
  window.sessionStorage.setItem(key, value);
}

/**
 * มุมพนักงานทุกหน้า:
 * - งานค้างส่ง → การ์ด/แถบเด่น · ไปส่ง (ไม่ใช่รับทราบ)
 * - แจ้งเบา → รับทราบวันนี้
 */
export function StaffTaskNudge() {
  const { staff, status, isPermPreview } = useAuth();
  const isOwner = staff?.role === "owner";
  const myEmployeeId = staff?.employeeId || "";
  const myName = (staff?.displayName || "").trim() || "พนักงาน";
  const ready = status === "ready" && !!staff && !isOwner && !!myEmployeeId;

  const [rows, setRows] = useState<TaskOccurrence[]>([]);
  const [workPopupOpen, setWorkPopupOpen] = useState(false);
  const [softPopupOpen, setSoftPopupOpen] = useState(false);
  const [stripExpanded, setStripExpanded] = useState(false);
  const [ackTick, setAckTick] = useState(0);
  const [acking, setAcking] = useState(false);

  useEffect(() => {
    if (!ready) {
      setRows([]);
      return;
    }
    return subscribeTaskOccurrencesForAssignee(
      myEmployeeId,
      (next) => setRows(next),
      () => setRows([]),
      { since: taskOccurrenceSinceMs() },
    );
  }, [ready, myEmployeeId]);

  const workItems = useMemo(() => actionableStaffWorkItems(rows), [rows]);
  const softItems = useMemo(
    () => actionableStaffTaskNudges(rows, myEmployeeId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, ackTick, myEmployeeId],
  );

  const workFp = useMemo(() => staffWorkNudgeFingerprint(workItems), [workItems]);
  const softFp = useMemo(() => staffTaskNudgeFingerprint(softItems), [softItems]);
  const workSummary = useMemo(() => summarizeStaffWorkNudges(workItems), [workItems]);
  const softSummary = useMemo(() => summarizeStaffTaskNudges(softItems), [softItems]);

  useEffect(() => {
    if (!workItems.length || !workFp) {
      setWorkPopupOpen(false);
      return;
    }
    if (readKey(STAFF_WORK_NUDGE_DISMISS_KEY) === workFp) {
      setWorkPopupOpen(false);
      return;
    }
    setWorkPopupOpen(true);
  }, [workItems.length, workFp]);

  useEffect(() => {
    if (workPopupOpen) {
      setSoftPopupOpen(false);
      return;
    }
    if (!softItems.length || !softFp) {
      setSoftPopupOpen(false);
      return;
    }
    if (readKey(STAFF_TASK_NUDGE_DISMISS_KEY) === softFp) {
      setSoftPopupOpen(false);
      return;
    }
    setSoftPopupOpen(true);
  }, [softItems.length, softFp, workPopupOpen]);

  if (!ready || (!workItems.length && !softItems.length)) return null;

  function dismissWorkPopup() {
    writeKey(STAFF_WORK_NUDGE_DISMISS_KEY, workFp);
    setWorkPopupOpen(false);
  }

  function dismissSoftPopup() {
    writeKey(STAFF_TASK_NUDGE_DISMISS_KEY, softFp);
    setSoftPopupOpen(false);
  }

  async function persistAck(occ: TaskOccurrence | undefined) {
    if (!occ || !myEmployeeId || isPermPreview) return;
    try {
      await reportTaskNotifyAck(occ, {
        employeeId: myEmployeeId,
        employeeName: myName,
      });
    } catch {
      /* local already set */
    }
  }

  async function acknowledge(itemId: string) {
    if (acking || isPermPreview) return;
    const occ = rows.find((r) => r.id === itemId);
    acknowledgeNotifyToday(itemId);
    setAckTick((n) => n + 1);
    setAcking(true);
    try {
      await persistAck(occ);
    } finally {
      setAcking(false);
    }
  }

  async function acknowledgeAllSoft() {
    if (acking || isPermPreview) return;
    const ids = softItems.map((i) => i.id);
    acknowledgeNotifyTodayMany(ids);
    writeKey(STAFF_TASK_NUDGE_DISMISS_KEY, softFp);
    setSoftPopupOpen(false);
    setAckTick((n) => n + 1);
    setAcking(true);
    try {
      await Promise.all(ids.map((id) => persistAck(rows.find((r) => r.id === id))));
    } finally {
      setAcking(false);
    }
  }

  const stripMode = workItems.length ? "work" : "soft";
  const stripCount = workItems.length ? workSummary.total : softSummary.total;
  const stripHeadline = workItems.length ? workSummary.headline : softSummary.headline;

  return (
    <>
      {workPopupOpen ? (
        <div
          className="staff-work-modal"
          role="dialog"
          aria-modal="true"
          aria-label="งานค้างส่ง"
        >
          <button
            type="button"
            className="staff-work-modal-scrim"
            aria-label="ปิด"
            onClick={dismissWorkPopup}
          />
          <div className={`staff-work-modal-card${workSummary.overdue ? " is-overdue" : ""}`}>
            <div className="staff-work-modal-top">
              <p className="staff-work-modal-kicker">
                <Camera size={15} aria-hidden />
                งานค้างส่ง {workSummary.total}
                {workSummary.overdue ? (
                  <span className="staff-task-nudge-pill is-overdue">
                    เลยกำหนด {workSummary.overdue}
                  </span>
                ) : null}
              </p>
              <button
                type="button"
                className="staff-task-nudge-close"
                onClick={dismissWorkPopup}
                aria-label="ปิด"
              >
                <X size={16} aria-hidden />
              </button>
            </div>
            <p className="staff-work-modal-title">{workSummary.headline}</p>
            {workItems[0]?.note ? (
              <p className="staff-work-modal-note">{workItems[0].note}</p>
            ) : null}
            {workItems[0]?.dueDate ? (
              <p className="muted staff-work-modal-due">
                ครบ {formatDateShortBe(workItems[0].dueDate)}
              </p>
            ) : null}
            <p className="muted staff-work-modal-hint">
              {isPermPreview
                ? "พรีวิว — ดูได้อย่างเดียว"
                : "ต้องส่งงาน · ปิดได้ แต่แถบล่างยังเตือน"}
            </p>
            <div className="staff-work-modal-actions">
              <button
                type="button"
                className="ghost-btn staff-task-nudge-btn"
                onClick={dismissWorkPopup}
              >
                ปิดไว้ก่อน
              </button>
              <Link
                href="/tasks/"
                className="primary-btn staff-task-nudge-btn"
                onClick={dismissWorkPopup}
              >
                <Camera size={14} aria-hidden />
                ไปส่งงาน
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      {softPopupOpen && !workPopupOpen ? (
        <div className="staff-task-nudge-float" role="region" aria-label="แจ้งเตือน">
          <div className="staff-task-nudge-float-card">
            <div className="staff-task-nudge-float-top">
              <p className="staff-task-nudge-kicker">
                <ListTodo size={13} aria-hidden />
                แจ้งเตือน {softSummary.total}
              </p>
              <button
                type="button"
                className="staff-task-nudge-close"
                onClick={dismissSoftPopup}
                aria-label="หุบรอบนี้"
              >
                <X size={15} aria-hidden />
              </button>
            </div>
            <p className="staff-task-nudge-headline">{softSummary.headline}</p>
            <p className="muted staff-task-nudge-day-hint">
              {isPermPreview
                ? "พรีวิว — ดูได้อย่างเดียว ไม่บันทึกรับทราบจริง"
                : "รับทราบวันนี้ · พรุ่งนี้แจ้งใหม่"}
            </p>
            <div className="staff-task-nudge-float-actions">
              <button
                type="button"
                className="ghost-btn staff-task-nudge-btn"
                onClick={dismissSoftPopup}
              >
                ไว้ก่อน
              </button>
              <button
                type="button"
                className="primary-btn staff-task-nudge-btn"
                onClick={() => void acknowledgeAllSoft()}
                disabled={acking || isPermPreview}
              >
                <Check size={14} aria-hidden />
                รับทราบวันนี้
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div
        className={`staff-task-nudge-strip${stripExpanded ? " is-open" : ""}${
          stripMode === "work" ? " is-work" : ""
        }${workSummary.overdue ? " is-overdue" : ""}`}
        role="region"
        aria-label={stripMode === "work" ? "แถบงานค้างส่ง" : "แถบแจ้งเตือน"}
      >
        <button
          type="button"
          className="staff-task-nudge-strip-main"
          aria-expanded={stripExpanded}
          onClick={() => setStripExpanded((v) => !v)}
        >
          {stripMode === "work" ? (
            <Camera size={14} aria-hidden />
          ) : (
            <ListTodo size={14} aria-hidden />
          )}
          <span className="staff-task-nudge-strip-text">
            {stripMode === "work" ? "งานค้างส่ง" : "แจ้งเตือน"} {stripCount}
            {stripHeadline ? ` · ${stripHeadline}` : ""}
          </span>
          {stripExpanded ? (
            <ChevronDown size={14} aria-hidden />
          ) : (
            <ChevronUp size={14} aria-hidden />
          )}
        </button>
        {stripExpanded ? (
          <ul className="staff-task-nudge-list">
            {stripMode === "work"
              ? workItems.slice(0, 6).map((item) => (
                  <li key={item.id}>
                    <span
                      className={`staff-task-nudge-kind is-${item.urgency}`}
                      title={
                        item.urgency === "overdue"
                          ? "เลยกำหนด"
                          : item.urgency === "dueSoon"
                            ? "ใกล้ครบ"
                            : "เปิดส่งได้"
                      }
                    >
                      {item.urgency === "overdue"
                        ? "ค้าง"
                        : item.urgency === "dueSoon"
                          ? "ใกล้"
                          : "ส่ง"}
                    </span>
                    <span className="staff-task-nudge-list-title">{item.title}</span>
                    {item.dueDate ? (
                      <span className="muted staff-task-nudge-list-due">
                        {formatDateShortBe(item.dueDate)}
                      </span>
                    ) : null}
                    <Link href="/tasks/" className="ghost-btn staff-task-nudge-ack">
                      ไปส่ง
                    </Link>
                  </li>
                ))
              : softItems.slice(0, 6).map((item) => (
                  <li key={item.id}>
                    <span className="staff-task-nudge-kind is-soft">เบา</span>
                    <span className="staff-task-nudge-list-title">{item.title}</span>
                    <button
                      type="button"
                      className="ghost-btn staff-task-nudge-ack"
                      onClick={() => void acknowledge(item.id)}
                      disabled={acking || isPermPreview}
                    >
                      รับทราบ
                    </button>
                  </li>
                ))}
            <li className="staff-task-nudge-list-foot">
              <Link href="/tasks/" className="staff-task-nudge-link">
                {stripMode === "work" ? "เปิดหน้างานของฉัน" : "เปิดหน้ารายการ"}
              </Link>
              {stripMode === "work" && softItems.length ? (
                <span className="muted staff-task-nudge-soft-side">
                  · แจ้งเบาอีก {softItems.length}
                </span>
              ) : null}
            </li>
          </ul>
        ) : null}
      </div>
    </>
  );
}
