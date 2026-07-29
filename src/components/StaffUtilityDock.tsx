"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Lightbulb, ListTodo, Sparkles, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import {
  countPendingSuggestions,
  createStaffSuggestion,
  formatSuggestionWhen,
  subscribeStaffSuggestions,
  SUGGESTION_STATUS_LABELS,
  updateStaffSuggestionStatus,
  type StaffSuggestion,
  type SuggestionStatus,
} from "@/lib/staff-suggestions";
import {
  STAFF_UTILITY_CATALOG,
  staffUtilityAttentionCount,
  type StaffUtilitySlot,
} from "@/lib/staff-utility";
import { subscribeTaskOccurrencesForAssignee } from "@/lib/task-occurrences";
import { filterOccurrencesByTab } from "@/lib/task-weekly-logic";
import { cn } from "@/lib/utils";

const OWNER_STATUS_ACTIONS: SuggestionStatus[] = ["accepted", "later", "done"];

/**
 * ไอคอนยูทิลิตี้ซ้ายมือ — พนักงาน + เจ้าของ
 * แผง: ข้อเสนอ (ใช้ได้) · งาน (โครง + กระพริบเมื่อมีค้าง)
 */
export function StaffUtilityDock() {
  const pathname = usePathname();
  const { staff, actorId, status } = useAuth();
  const isOwner = staff?.role === "owner";
  const [open, setOpen] = useState(false);
  const [slot, setSlot] = useState<StaffUtilitySlot>("suggestions");
  const [suggestions, setSuggestions] = useState<StaffSuggestion[]>([]);
  const [pendingTasks, setPendingTasks] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);

  const ready = status === "ready" && !!staff;
  const myEmployeeId = staff?.employeeId || "";

  useBodyScrollLock(open);

  useEffect(() => {
    if (!ready || !actorId) return;
    return subscribeStaffSuggestions({
      isOwner,
      actorId,
      onRows: setSuggestions,
      onError: (err) => setError(err.message),
    });
  }, [ready, isOwner, actorId]);

  useEffect(() => {
    if (!ready) return;
    // เจ้าของ: ไม่กระพริบจากงานมอบหมายส่วนตัว — ใช้ข้อเสนอที่รอดู
    if (isOwner || !myEmployeeId) {
      setPendingTasks(0);
      return;
    }
    return subscribeTaskOccurrencesForAssignee(
      myEmployeeId,
      (rows) => {
        setPendingTasks(filterOccurrencesByTab(rows, "thisWeek").length);
      },
      () => setPendingTasks(0),
    );
  }, [ready, isOwner, myEmployeeId]);

  const pendingSuggestionCount = useMemo(() => {
    if (isOwner) return countPendingSuggestions(suggestions);
    return 0;
  }, [isOwner, suggestions]);

  const attention = staffUtilityAttentionCount({
    pendingTaskCount: isOwner ? 0 : pendingTasks,
    pendingSuggestionCount,
  });

  if (!ready) return null;
  if (pathname.startsWith("/pos")) return null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await createStaffSuggestion({
        title,
        body,
        createdBy: actorId,
        createdByName: staff?.displayName || actorId,
        employeeId: myEmployeeId,
      });
      setTitle("");
      setBody("");
    } catch (err) {
      setError((err as Error).message || "ส่งไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function onOwnerStatus(id: string, next: SuggestionStatus) {
    if (statusBusyId) return;
    setStatusBusyId(id);
    setError(null);
    try {
      await updateStaffSuggestionStatus(id, next);
    } catch (err) {
      setError((err as Error).message || "อัปเดตไม่สำเร็จ");
    } finally {
      setStatusBusyId(null);
    }
  }

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
          onClick={() => setOpen(false)}
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
                onClick={() => setOpen(false)}
              >
                <X size={18} />
              </button>
            </header>

            <div className="staff-utility-tabs" role="tablist" aria-label="หมวดยูทิลิตี้">
              {(Object.keys(STAFF_UTILITY_CATALOG) as StaffUtilitySlot[]).map((key) => {
                const meta = STAFF_UTILITY_CATALOG[key];
                const badge =
                  key === "tasks" && !isOwner && pendingTasks > 0
                    ? pendingTasks
                    : key === "suggestions" && isOwner && pendingSuggestionCount > 0
                      ? pendingSuggestionCount
                      : 0;
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={slot === key}
                    className={cn(
                      "staff-utility-tab",
                      slot === key && "is-active",
                      badge > 0 && "has-badge",
                    )}
                    onClick={() => setSlot(key)}
                  >
                    {key === "suggestions" ? (
                      <Lightbulb size={14} aria-hidden />
                    ) : (
                      <ListTodo size={14} aria-hidden />
                    )}
                    <span>{meta.label}</span>
                    {badge > 0 ? (
                      <span className="staff-utility-tab-badge">{badge > 9 ? "9+" : badge}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {error ? <p className="error-text staff-utility-error">{error}</p> : null}

            {slot === "suggestions" ? (
              <div className="staff-utility-body">
                {!isOwner ? (
                  <form className="staff-utility-form" onSubmit={(e) => void onSubmit(e)}>
                    <label>
                      <span>อยากให้ร้านทำอะไร</span>
                      <input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        maxLength={80}
                        placeholder="หัวข้อสั้นๆ"
                        required
                      />
                    </label>
                    <label>
                      <span>รายละเอียด (ถ้ามี)</span>
                      <textarea
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        maxLength={500}
                        rows={3}
                        placeholder="เช่น ซื้อพัดลม / ปรับขั้นตอนปิดร้าน"
                      />
                    </label>
                    <button type="submit" className="primary-btn" disabled={busy || !title.trim()}>
                      {busy ? "กำลังส่ง…" : "ส่งข้อเสนอ"}
                    </button>
                  </form>
                ) : (
                  <p className="muted staff-utility-owner-hint">
                    พนักงานส่งมาจากไอคอนนี้ · กดสถานะสั้นๆ ได้เลย
                  </p>
                )}

                <ul className="staff-utility-list">
                  {suggestions.length === 0 ? (
                    <li className="muted staff-utility-empty">ยังไม่มีข้อเสนอ</li>
                  ) : (
                    suggestions.map((row) => (
                      <li key={row.id} className="staff-utility-item">
                        <div className="staff-utility-item-top">
                          <strong>{row.title}</strong>
                          <span
                            className={cn(
                              "staff-utility-status",
                              `is-${row.status}`,
                            )}
                          >
                            {SUGGESTION_STATUS_LABELS[row.status]}
                          </span>
                        </div>
                        {row.body ? <p>{row.body}</p> : null}
                        <p className="muted staff-utility-meta">
                          {isOwner ? `${row.createdByName || "—"} · ` : null}
                          {formatSuggestionWhen(row.createdAt)}
                          {row.ownerNote ? ` · ${row.ownerNote}` : null}
                        </p>
                        {isOwner ? (
                          <div className="staff-utility-actions">
                            {OWNER_STATUS_ACTIONS.map((st) => (
                              <button
                                key={st}
                                type="button"
                                className={cn(
                                  "ghost-btn staff-utility-status-btn",
                                  row.status === st && "is-current",
                                )}
                                disabled={statusBusyId === row.id || row.status === st}
                                onClick={() => void onOwnerStatus(row.id, st)}
                              >
                                {SUGGESTION_STATUS_LABELS[st]}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </li>
                    ))
                  )}
                </ul>
              </div>
            ) : (
              <div className="staff-utility-body staff-utility-tasks-scaffold">
                <p>
                  {pendingTasks > 0
                    ? `มีงานค้าง ${pendingTasks} รายการ`
                    : isOwner
                      ? "โครงย้ายงานมอบหมายมาไว้ที่นี่"
                      : "ตอนนี้ยังไม่มีงานค้างเปิดอยู่"}
                </p>
                <p className="muted">
                  เร็วๆ นี้จะย้ายงานจากแถบล่างมาไอคอนนี้ — กดแล้วกระพริบเมื่อมีค้าง
                </p>
                <Link
                  href="/tasks/"
                  className="primary-btn staff-utility-tasks-link"
                  onClick={() => setOpen(false)}
                >
                  เปิดหน้างาน
                </Link>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
