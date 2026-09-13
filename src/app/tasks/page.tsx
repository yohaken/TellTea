"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Camera,
  Check,
  ImageIcon,
  ListTodo,
  Pencil,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { ImagePreviewModal } from "@/components/EntryPhotoCell";
import { ModuleTabDock } from "@/components/ModuleTabDock";
import { PhotoAttachMultiField } from "@/components/PhotoAttachMultiField";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { useAuth } from "@/lib/auth";
import { resolveWorkerDisplayNames } from "@/lib/employee-rename-propagate";
import { listActiveEmployees, type Employee } from "@/lib/employees";
import { isAppOwnerEmail } from "@/lib/firebase";
import { profileStatusLabel } from "@/lib/profile";
import {
  addTaskProgressNote,
  collectOpenTaskOccurrences,
  completeTaskOccurrence,
  deactivateTaskTemplateClearingOpen,
  deleteTaskProgressNote,
  dismissAndDeleteOpenTaskOccurrences,
  isOpenTaskOccurrenceStatus,
  reportTaskNotifyAck,
  reportTaskOccurrenceWaiting,
  subscribeTaskOccurrences,
  subscribeTaskOccurrencesForAssignee,
  syncPendingOccurrencesFromTemplate,
  taskOccurrenceSinceMs,
} from "@/lib/task-occurrences";
import {
  createTaskTemplate,
  deleteTaskTemplate,
  subscribeTaskTemplates,
  updateTaskTemplate,
} from "@/lib/task-templates";
import { runTaskOccurrenceSync } from "@/lib/task-sync";
import {
  acknowledgeNotifyToday,
  isEmployeeNotifyAckedToday,
  openOwnerNewsOccurrences,
  summarizeOwnerNotifyAcks,
} from "@/lib/staff-task-nudge";
import {
  TASK_PROGRESS_NOTE_MAX,
  isNotifyOnlyNudge,
  type TaskOccurrence,
  type TaskTemplate,
} from "@/lib/task-types";
import {
  applyDismissBlocksToTemplates,
  getTaskProofImgs,
  labelWeekdayShort,
  mergeDismissedPeriodKeys,
  TASK_PROOF_MAX,
  validateTaskCompleteInput,
  WEEKDAY_LABELS,
} from "@/lib/task-weekly-logic";
import { formatDateShortBe, formatDateTimeShortBe } from "@/lib/utils";

/** ลบกติกาถาวร + รอบที่ยังไม่ส่ง (ประวัติที่ส่งแล้วคงไว้) */
async function purgeTaskTemplate(
  template: TaskTemplate,
  occurrences: TaskOccurrence[],
): Promise<{ deletedIds: string[]; periodKeys: string[] }> {
  const result = await dismissAndDeleteOpenTaskOccurrences(template.id, occurrences);
  await deleteTaskTemplate(template.id);
  return result;
}

const TASK_PRESETS: { title: string; weekday: number }[] = [
  { title: "โพสต์ Facebook ประจำสัปดาห์", weekday: 1 },
  { title: "คอนเทนต์รายเดือน", weekday: 1 },
];

export default function TasksPage() {
  return (
    <AuthGate>
      <TasksView />
    </AuthGate>
  );
}

function TasksView() {
  const { actorId, staff, user, isPermPreview } = useAuth();
  // พรีวิวมุมพนักงาน: ห้ามใช้ email เจ้าของดึง UI หลังร้าน (ตารางกติกา/ไทม์ไลน์)
  const isOwnerManager =
    !isPermPreview &&
    (staff?.role === "owner" || isAppOwnerEmail(user?.email));
  const myEmployeeId = staff?.employeeId || "";

  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [occurrences, setOccurrences] = useState<TaskOccurrence[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<TaskTemplate | null>(null);
  const [submitOcc, setSubmitOcc] = useState<TaskOccurrence | null>(null);
  const [previewUrls, setPreviewUrls] = useState<string[] | null>(null);
  /** แถบกติกาพับได้ — เริ่มพับ */
  const [rulesOpen, setRulesOpen] = useState(false);
  /** รีเฟรชสถานะรับทราบวันนี้ (local) */
  const [ackTick, setAckTick] = useState(0);
  const rulesInitRef = useRef(false);
  const syncedRef = useRef(false);
  /** กัน sync สร้างรอบกลับหลังลบ — ก่อน snapshot dismissedPeriodKeys ตามทัน */
  const dismissBlockRef = useRef<Set<string>>(new Set());

  const rememberDismissed = useCallback((templateId: string, periodKeys: string[]) => {
    const tid = String(templateId || "").trim();
    if (!tid) return;
    for (const pk of periodKeys) {
      if (pk) dismissBlockRef.current.add(`${tid}:${pk}`);
    }
    setTemplates((prev) =>
      prev.map((tpl) =>
        tpl.id === tid ? mergeDismissedPeriodKeys(tpl, periodKeys) : tpl,
      ),
    );
  }, []);

  const doSync = useCallback(async (tpls: TaskTemplate[], occs: TaskOccurrence[]) => {
    setSyncing(true);
    try {
      const merged = applyDismissBlocksToTemplates(tpls, dismissBlockRef.current);
      await runTaskOccurrenceSync(merged, occs);
    } catch (err) {
      setError((err as Error).message || "ซิงก์รอบงานไม่สำเร็จ");
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    if (!staff) return;

    if (isOwnerManager) {
      setLoading(true);
      let tplReady = false;
      let occReady = false;
      let empReady = false;
      const finish = () => {
        if (tplReady && occReady && empReady) setLoading(false);
      };

      void listActiveEmployees()
        .then(setEmployees)
        .catch((err) => setError((err as Error).message || "โหลดรายชื่อไม่สำเร็จ"))
        .finally(() => {
          empReady = true;
          finish();
        });

      const unsubTpl = subscribeTaskTemplates(
        (rows) => {
          setTemplates(rows);
          if (!tplReady) {
            tplReady = true;
            finish();
          }
        },
        (err) => setError(err.message || "โหลดกติกาไม่สำเร็จ"),
      );

      const unsubOcc = subscribeTaskOccurrences(
        (rows) => {
          setOccurrences(rows);
          if (!occReady) {
            occReady = true;
            finish();
          }
        },
        (err) => setError(err.message || "โหลดรอบงานไม่สำเร็จ"),
        { since: taskOccurrenceSinceMs() },
      );

      return () => {
        unsubTpl();
        unsubOcc();
      };
    }

    if (!myEmployeeId) {
      setTemplates([]);
      setOccurrences([]);
      setEmployees([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsubOcc = subscribeTaskOccurrencesForAssignee(
      myEmployeeId,
      (rows) => {
        setOccurrences(rows);
        setLoading(false);
      },
      (err) => {
        setError(err.message || "โหลดงานของฉันไม่สำเร็จ");
        setLoading(false);
      },
      { since: taskOccurrenceSinceMs() },
    );
    return () => unsubOcc();
  }, [staff, isOwnerManager, myEmployeeId]);

  useEffect(() => {
    if (!isOwnerManager || loading || syncedRef.current) return;
    syncedRef.current = true;
    void doSync(templates.filter((t) => t.active), occurrences);
  }, [isOwnerManager, loading, templates, occurrences, doSync]);

  useBodyScrollLock(createOpen || !!editingTemplate || !!submitOcc || !!previewUrls);

  const activeTemplates = useMemo(() => templates.filter((t) => t.active), [templates]);
  const ownerNewsRows = useMemo(
    () => (isOwnerManager ? openOwnerNewsOccurrences(occurrences) : []),
    [isOwnerManager, occurrences],
  );
  /** งานส่งที่ยังเปิด — มุมเจ้าของ */
  const ownerWorkOpen = useMemo(() => {
    if (!isOwnerManager) return [];
    const now = Date.now();
    return occurrences
      .filter((o) => !isNotifyOnlyNudge(o.nudgeKind))
      .filter(
        (o) =>
          (o.status === "pending" || o.status === "waiting" || o.status === "missed") &&
          now >= (o.openAt || 0),
      )
      .sort((a, b) => {
        const rank = (s: string) =>
          s === "missed" ? 0 : s === "waiting" ? 1 : 2;
        const ra = rank(a.status);
        const rb = rank(b.status);
        if (ra !== rb) return ra - rb;
        return a.dueDate - b.dueDate;
      });
  }, [isOwnerManager, occurrences]);

  useEffect(() => {
    if (rulesInitRef.current || loading) return;
    if (!isOwnerManager) return;
    rulesInitRef.current = true;
    setRulesOpen(false);
  }, [loading, isOwnerManager]);

  async function ackNotifyCloud(occ: TaskOccurrence) {
    if (isPermPreview) {
      setError("พรีวิวมุมพนักงาน — รับทราบจริงไม่ได้ · กดออกจากมุมมองก่อน");
      return;
    }
    acknowledgeNotifyToday(occ.id);
    setAckTick((n) => n + 1);
    if (!myEmployeeId) return;
    try {
      await reportTaskNotifyAck(occ, {
        employeeId: myEmployeeId,
        employeeName: (staff?.displayName || "").trim() || "พนักงาน",
      });
      setError(null);
    } catch (err) {
      setError((err as Error).message || "บันทึกรับทราบไม่สำเร็จ");
    }
  }

  if (!staff) return null;

  return (
    <div className="module-page tasks-page">
      <div className="module-page-head">
        <h1 className="panel-title module-page-title">
          <ListTodo size={18} aria-hidden />
          {isOwnerManager ? "งานมอบหมาย" : "งานของฉัน"}
        </h1>
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {!myEmployeeId && !isOwnerManager ? (
        <p className="empty">
          ยังไม่ได้ผูกชื่อในร้าน — ตั้งที่{" "}
          <a href="/profile/" style={{ fontWeight: 700 }}>
            โปรไฟล์พนักงาน
          </a>
        </p>
      ) : null}

      {loading || syncing ? <p className="empty">{loading ? "กำลังโหลด..." : "กำลังอัปเดตรอบงาน..."}</p> : null}

      {!loading && (myEmployeeId || isOwnerManager) ? (
        <>
          {isOwnerManager && activeTemplates.length ? (
            <div className={`tasks-template-bar${rulesOpen ? " is-open" : ""}`}>
              <button
                type="button"
                className="tasks-template-toggle"
                aria-expanded={rulesOpen}
                onClick={() => setRulesOpen((v) => !v)}
              >
                <span className="tasks-template-toggle-label">
                  กติกา {activeTemplates.length}
                </span>
                <span className="tasks-template-toggle-meta" aria-hidden>
                  {rulesOpen ? "ย่อ" : "แก้"}
                </span>
              </button>
              {rulesOpen ? (
                <ul className="tasks-template-list">
                  {activeTemplates.map((tpl) => (
                    <li key={tpl.id} className="tasks-template-row">
                      <span className="tasks-template-row-main" title={tpl.title}>
                        <span className="tasks-template-row-day">
                          {labelWeekdayShort(tpl.weekday)}
                        </span>
                        <span className="tasks-template-row-title">{tpl.title}</span>
                      </span>
                      <span className="tasks-template-row-acts">
                        <button
                          type="button"
                          className="tasks-template-act"
                          onClick={() => setEditingTemplate(tpl)}
                        >
                          <Pencil size={11} aria-hidden /> แก้
                        </button>
                        <button
                          type="button"
                          className="tasks-template-act"
                          title="หยุดสร้างรอบใหม่"
                          onClick={() => {
                            const openN = collectOpenTaskOccurrences(
                              tpl.id,
                              occurrences,
                            ).length;
                            const msg =
                              openN > 0
                                ? `ปิดกติกา "${tpl.title}"?\nรอบที่ยังไม่ส่ง ${openN} รายการจะหาย`
                                : `ปิดกติกา "${tpl.title}"?`;
                            if (!window.confirm(msg)) return;
                            void deactivateTaskTemplateClearingOpen(tpl.id, occurrences)
                              .then((result) => {
                                rememberDismissed(tpl.id, result.periodKeys);
                                setTemplates((prev) =>
                                  prev.map((t) =>
                                    t.id === tpl.id ? { ...t, active: false } : t,
                                  ),
                                );
                                setOccurrences((prev) =>
                                  prev.filter(
                                    (o) =>
                                      !(
                                        o.templateId === tpl.id &&
                                        isOpenTaskOccurrenceStatus(o.status)
                                      ),
                                  ),
                                );
                              })
                              .catch((err) =>
                                setError((err as Error).message || "ปิดกติกาไม่สำเร็จ"),
                              );
                          }}
                        >
                          <X size={11} aria-hidden /> ปิด
                        </button>
                        <button
                          type="button"
                          className="tasks-template-act is-danger"
                          title="ลบกติกาถาวร"
                          onClick={() => {
                            const pendingN = collectOpenTaskOccurrences(
                              tpl.id,
                              occurrences,
                            ).length;
                            const msg =
                              pendingN > 0
                                ? `ลบกติกา "${tpl.title}" ถาวร?\nรอบค้าง ${pendingN} รายการจะถูกลบ`
                                : `ลบกติกา "${tpl.title}" ถาวร?`;
                            if (!window.confirm(msg)) return;
                            void purgeTaskTemplate(tpl, occurrences)
                              .then((result) => {
                                rememberDismissed(tpl.id, result.periodKeys);
                                setTemplates((prev) => prev.filter((t) => t.id !== tpl.id));
                                setOccurrences((prev) =>
                                  prev.filter(
                                    (o) =>
                                      !(
                                        o.templateId === tpl.id &&
                                        isOpenTaskOccurrenceStatus(o.status)
                                      ),
                                  ),
                                );
                              })
                              .catch((err) =>
                                setError((err as Error).message || "ลบกติกาไม่สำเร็จ"),
                              );
                          }}
                        >
                          <Trash2 size={11} aria-hidden /> ลบ
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {isOwnerManager ? (
            <OwnerHomeTasks
              newsRows={ownerNewsRows}
              workRows={ownerWorkOpen}
              allOccurrences={occurrences}
              employees={employees}
              onError={setError}
              onViewPhoto={(urls) => setPreviewUrls(urls)}
              onDeleted={(result) => {
                rememberDismissed(result.templateId, result.periodKeys);
                const gone = new Set(result.deletedIds);
                setOccurrences((prev) => prev.filter((o) => !gone.has(o.id)));
              }}
            />
          ) : (
            <StaffMyTasks
              occurrences={occurrences}
              myEmployeeId={myEmployeeId}
              ackTick={ackTick}
              onAckToday={(occ) => {
                void ackNotifyCloud(occ);
              }}
              onSubmit={(occ) => setSubmitOcc(occ)}
              onViewPhoto={(urls) => setPreviewUrls(urls)}
            />
          )}
        </>
      ) : null}

      {createOpen ? (
        <TemplateFormModal
          employees={employees}
          actorId={actorId}
          onError={setError}
          onClose={() => setCreateOpen(false)}
          onSaved={async () => {
            setCreateOpen(false);
            syncedRef.current = false;
          }}
        />
      ) : null}

      {editingTemplate ? (
        <TemplateFormModal
          template={editingTemplate}
          employees={employees}
          actorId={actorId}
          occurrences={occurrences}
          onError={setError}
          onClose={() => setEditingTemplate(null)}
          onSaved={async (opts) => {
            setEditingTemplate(null);
            if (opts?.deleted && opts.templateId) {
              rememberDismissed(opts.templateId, opts.periodKeys || []);
              setTemplates((prev) => prev.filter((t) => t.id !== opts.templateId));
              setOccurrences((prev) =>
                prev.filter(
                  (o) =>
                    !(
                      o.templateId === opts.templateId &&
                      isOpenTaskOccurrenceStatus(o.status)
                    ),
                ),
              );
              return;
            }
            syncedRef.current = false;
          }}
        />
      ) : null}

      {submitOcc ? (
        <SubmitOccurrenceModal
          occ={
            occurrences.find((o) => o.id === submitOcc.id) || submitOcc
          }
          actorId={actorId || staff?.id || ""}
          employeeId={myEmployeeId}
          authorName={
            profileStatusLabel(staff) ||
            staff?.displayName ||
            (isOwnerManager ? "เจ้าของ" : "พนักงาน")
          }
          authorRole={isOwnerManager || staff?.role === "owner" ? "owner" : "staff"}
          isOwner={isOwnerManager || staff?.role === "owner"}
          onError={setError}
          onClose={() => setSubmitOcc(null)}
          onSaved={() => setSubmitOcc(null)}
        />
      ) : null}

      {previewUrls ? (
        <ImagePreviewModal urls={previewUrls} title="หลักฐานงาน" onClose={() => setPreviewUrls(null)} />
      ) : null}

      {isOwnerManager ? (
        <ModuleTabDock
          ariaLabel="มอบหมายงาน"
          formOpen={createOpen}
          onAdd={() => setCreateOpen(true)}
          addLabel="+ มอบหมาย"
        />
      ) : null}
    </div>
  );
}

/** มุมเจ้าของ — ข่าวสาร + งานค้าง แบบสั้น */
function OwnerHomeTasks({
  newsRows,
  workRows,
  allOccurrences,
  employees = [],
  onError,
  onViewPhoto,
  onDeleted,
}: {
  newsRows: TaskOccurrence[];
  workRows: TaskOccurrence[];
  allOccurrences: TaskOccurrence[];
  employees?: Employee[];
  onError: (msg: string) => void;
  onViewPhoto: (urls: string[]) => void;
  onDeleted?: (result: {
    templateId: string;
    deletedIds: string[];
    periodKeys: string[];
  }) => void;
}) {
  async function onDelete(occ: TaskOccurrence, kind: "ข่าวสาร" | "งาน") {
    const open = collectOpenTaskOccurrences(occ.templateId, allOccurrences);
    const n = Math.max(1, open.length);
    if (
      !window.confirm(
        n > 1
          ? `เอา${kind} "${occ.title}" ออก?\nรอบเปิด ${n} รายการจะหาย`
          : `เอา${kind} "${occ.title}" ออก?`,
      )
    ) {
      return;
    }
    try {
      const result = await dismissAndDeleteOpenTaskOccurrences(
        occ.templateId,
        allOccurrences,
      );
      onError("");
      onDeleted?.({
        templateId: occ.templateId,
        deletedIds: result.deletedIds.length ? result.deletedIds : [occ.id],
        periodKeys: result.periodKeys,
      });
    } catch (err) {
      onError((err as Error).message || "ลบไม่สำเร็จ");
    }
  }

  if (!newsRows.length && !workRows.length) {
    return <p className="empty">ยังไม่มีรายการเปิด — กด + มอบหมาย</p>;
  }

  return (
    <div className="tasks-staff-home tasks-owner-home">
      {newsRows.length ? (
        <section className="tasks-staff-section" aria-label="ข่าวสาร">
          <h2 className="tasks-staff-section-title">ข่าวสาร</h2>
          <ul className="tasks-staff-list">
            {newsRows.map((occ) => {
              const summary = summarizeOwnerNotifyAcks(occ);
              const displayNames = resolveWorkerDisplayNames(
                occ.assigneeIds,
                occ.assigneeNames,
                employees,
              );
              const people = summary.people.map((p, i) => ({
                ...p,
                name: displayNames[i] || p.name,
              }));
              const allDone =
                summary.assigneeCount > 0 && summary.pendingTodayCount === 0;
              const last = summary.lastAck;

              return (
                <li
                  key={occ.id}
                  className={`tasks-staff-item tasks-owner-item is-news${allDone ? " is-acked" : ""}`}
                >
                  <div className="tasks-staff-item-main">
                    <strong className="tasks-staff-item-title">{occ.title}</strong>
                    <span className="muted tasks-staff-item-meta">
                      {occ.nudgeKind === "deadline"
                        ? `ครบ ${formatDateShortBe(occ.dueDate)} · `
                        : ""}
                      {allDone
                        ? `ครบ ${summary.ackedTodayCount} คน`
                        : `รับแล้ว ${summary.ackedTodayCount}/${summary.assigneeCount}`}
                      {last ? ` · ล่าสุด ${last.name}` : ""}
                    </span>
                    {people.length ? (
                      <ul className="tasks-news-people" aria-label="รับทราบวันนี้">
                        {people.map((p) => (
                          <li
                            key={p.employeeId}
                            className={
                              p.ackedToday
                                ? "tasks-news-person is-acked"
                                : "tasks-news-person is-pending"
                            }
                          >
                            <span className="tasks-news-person-mark" aria-hidden>
                              {p.ackedToday ? "✓" : "·"}
                            </span>
                            <span className="tasks-news-person-name">{p.name}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="ghost-btn tasks-staff-item-btn is-ghost"
                    onClick={() => void onDelete(occ, "ข่าวสาร")}
                    aria-label={`เอา ${occ.title} ออก`}
                  >
                    <Trash2 size={13} aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {workRows.length ? (
        <section className="tasks-staff-section" aria-label="งานส่ง">
          <h2 className="tasks-staff-section-title">งานส่ง</h2>
          <ul className="tasks-staff-list">
            {workRows.map((occ) => {
              const waiting = occ.status === "waiting";
              const missed = occ.status === "missed";
              const proofs = getTaskProofImgs(occ);
              const who =
                resolveWorkerDisplayNames(
                  occ.assigneeIds,
                  occ.assigneeNames,
                  employees,
                ).join(" · ") || "—";

              return (
                <li
                  key={occ.id}
                  className={`tasks-staff-item tasks-owner-item${missed ? " is-late" : ""}${waiting ? " is-waiting" : ""}`}
                >
                  <div className="tasks-staff-item-main">
                    <strong className="tasks-staff-item-title">{occ.title}</strong>
                    <span className="muted tasks-staff-item-meta">
                      {who} · {formatDateShortBe(occ.dueDate)}
                      {missed ? " · ค้าง" : waiting ? " · รออยู่" : ""}
                    </span>
                    {occ.note?.trim() ? (
                      <span className="tasks-staff-item-note">{occ.note.trim()}</span>
                    ) : null}
                    {waiting && occ.completionNote?.trim() ? (
                      <span className="tasks-staff-item-note">
                        {occ.completionNote.trim()}
                      </span>
                    ) : null}
                  </div>
                  <div className="tasks-staff-item-acts">
                    {proofs.length ? (
                      <button
                        type="button"
                        className="ghost-btn tasks-staff-item-btn is-ghost"
                        onClick={() => onViewPhoto(proofs)}
                      >
                        <ImageIcon size={13} aria-hidden /> รูป
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="ghost-btn tasks-staff-item-btn is-ghost"
                      onClick={() => void onDelete(occ, "งาน")}
                      aria-label={`เอา ${occ.title} ออก`}
                    >
                      <Trash2 size={13} aria-hidden />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** มุมพนักงาน — รายการสั้น ปุ่มเดียวต่อแถว */
function StaffMyTasks({
  occurrences,
  myEmployeeId,
  ackTick = 0,
  onAckToday,
  onSubmit,
  onViewPhoto,
}: {
  occurrences: TaskOccurrence[];
  myEmployeeId: string;
  ackTick?: number;
  onAckToday: (occ: TaskOccurrence) => void;
  onSubmit: (occ: TaskOccurrence) => void;
  onViewPhoto: (urls: string[]) => void;
}) {
  void ackTick;
  const now = Date.now();

  const news = useMemo(
    () =>
      occurrences
        .filter((o) => isNotifyOnlyNudge(o.nudgeKind))
        .filter((o) => o.status === "pending" && now >= (o.openAt || 0))
        .sort((a, b) => a.dueDate - b.dueDate || a.title.localeCompare(b.title, "th")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [occurrences, ackTick],
  );

  const work = useMemo(
    () =>
      occurrences
        .filter((o) => !isNotifyOnlyNudge(o.nudgeKind))
        .filter(
          (o) =>
            (o.status === "pending" || o.status === "waiting" || o.status === "missed") &&
            now >= (o.openAt || 0),
        )
        .sort((a, b) => {
          const rank = (s: string) =>
            s === "missed" ? 0 : s === "waiting" ? 1 : 2;
          const ra = rank(a.status);
          const rb = rank(b.status);
          if (ra !== rb) return ra - rb;
          return a.dueDate - b.dueDate;
        }),
    [occurrences],
  );

  if (!news.length && !work.length) {
    return <p className="empty">ไม่มีรายการที่ต้องทำตอนนี้</p>;
  }

  return (
    <div className="tasks-staff-home">
      {news.length ? (
        <section className="tasks-staff-section" aria-label="ข่าวสาร">
          <h2 className="tasks-staff-section-title">ข่าวสาร</h2>
          <ul className="tasks-staff-list">
            {news.map((occ) => {
              const acked = isEmployeeNotifyAckedToday(occ, myEmployeeId);
              const note = (occ.note || "").trim();
              const due =
                occ.nudgeKind === "deadline" && occ.dueDate
                  ? `ครบ ${formatDateShortBe(occ.dueDate)}`
                  : "";
              return (
                <li
                  key={occ.id}
                  className={`tasks-staff-item${acked ? " is-acked" : ""}`}
                >
                  <div className="tasks-staff-item-main">
                    <strong className="tasks-staff-item-title">{occ.title}</strong>
                    {due || note ? (
                      <span className="tasks-staff-item-note" title={[due, note].filter(Boolean).join(" · ")}>
                        {[due, note].filter(Boolean).join(" · ")}
                      </span>
                    ) : null}
                  </div>
                  {acked ? (
                    <span className="muted tasks-staff-item-done">รับแล้ววันนี้</span>
                  ) : (
                    <button
                      type="button"
                      className="primary-btn tasks-staff-item-btn"
                      onClick={() => onAckToday(occ)}
                    >
                      <Check size={14} aria-hidden /> รับทราบ
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {work.length ? (
        <section className="tasks-staff-section" aria-label="งานส่ง">
          <h2 className="tasks-staff-section-title">งานส่ง</h2>
          <ul className="tasks-staff-list">
            {work.map((occ) => {
              const waiting = occ.status === "waiting";
              const missed = occ.status === "missed";
              const proofs = getTaskProofImgs(occ);
              return (
                <li
                  key={occ.id}
                  className={`tasks-staff-item${missed ? " is-late" : ""}${waiting ? " is-waiting" : ""}`}
                >
                  <div className="tasks-staff-item-main">
                    <strong className="tasks-staff-item-title">{occ.title}</strong>
                    <span className="muted tasks-staff-item-meta">
                      {formatDateShortBe(occ.dueDate)}
                      {missed ? " · ค้าง" : waiting ? " · รออยู่" : ""}
                    </span>
                    {occ.note?.trim() ? (
                      <span className="tasks-staff-item-note">{occ.note.trim()}</span>
                    ) : null}
                  </div>
                  <div className="tasks-staff-item-acts">
                    {proofs.length ? (
                      <button
                        type="button"
                        className="ghost-btn tasks-staff-item-btn is-ghost"
                        onClick={() => onViewPhoto(proofs)}
                      >
                        <ImageIcon size={13} aria-hidden /> รูป
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="primary-btn tasks-staff-item-btn"
                      onClick={() => onSubmit(occ)}
                    >
                      <Camera size={14} aria-hidden />{" "}
                      {waiting ? "อัปเดต" : missed ? "ส่งย้อน" : "ส่งงาน"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** หมวดข่าวสาร — เจ้าของเห็นใครรับทราบวันนี้แบบชิปรายคน */
function TemplateFormModal({
  template,
  employees,
  actorId,
  occurrences = [],
  onError,
  onClose,
  onSaved,
}: {
  template?: TaskTemplate;
  employees: Employee[];
  actorId: string;
  occurrences?: TaskOccurrence[];
  onError: (msg: string) => void;
  onClose: () => void;
  onSaved: (opts?: {
    deleted?: boolean;
    templateId?: string;
    periodKeys?: string[];
  }) => void;
}) {
  const isEdit = !!template;
  const [title, setTitle] = useState(template?.title || "");
  const [note, setNote] = useState(template?.note || "");
  const [weekday, setWeekday] = useState(template?.weekday ?? 1);
  const [nudgeKind, setNudgeKind] = useState<"soft" | "deadline" | "task">(
    template?.nudgeKind === "soft"
      ? "soft"
      : template?.nudgeKind === "deadline"
        ? "deadline"
        : "task",
  );
  const [selected, setSelected] = useState<string[]>(template?.assigneeIds || []);
  const [busy, setBusy] = useState(false);

  function applyPreset(preset: (typeof TASK_PRESETS)[number]) {
    if (isEdit) return;
    setTitle(preset.title);
    setWeekday(preset.weekday);
  }

  function toggleWorker(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function selectAllWorkers() {
    setSelected(employees.map((w) => w.id));
  }

  function clearWorkers() {
    setSelected([]);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!actorId) return;
    const chosen = employees.filter((w) => selected.includes(w.id));
    if (!chosen.length) {
      onError("เลือกพนักงานอย่างน้อย 1 คน");
      return;
    }
    // เลิกเช็คลิสย่อยในกติกา — ความคืบอยู่ที่โนตในแต่ละรอบ
    const payload = {
      title,
      note,
      weekday,
      openDaysBefore: nudgeKind === "deadline" ? 7 : 3,
      checklist: [] as { id: string; label: string }[],
      assigneeIds: chosen.map((w) => w.id),
      assigneeNames: chosen.map((w) => w.name),
      nudgeKind,
    };
    setBusy(true);
    onError("");
    try {
      if (isEdit && template) {
        await updateTaskTemplate(template.id, payload);
        const pendingIds = collectOpenTaskOccurrences(template.id, occurrences).map(
          (o) => o.id,
        );
        if (pendingIds.length) {
          await syncPendingOccurrencesFromTemplate(
            {
              templateId: template.id,
              title: payload.title.trim(),
              note: (payload.note || "").trim(),
              checklist: [],
              assigneeIds: payload.assigneeIds,
              assigneeNames: payload.assigneeNames,
              nudgeKind: payload.nudgeKind,
            },
            pendingIds,
          );
        }
      } else {
        await createTaskTemplate({ ...payload, createdBy: actorId });
      }
      onSaved();
    } catch (err) {
      onError((err as Error).message || (isEdit ? "แก้ไขกติกาไม่สำเร็จ" : "สร้างกติกาไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteTemplate() {
    if (!template) return;
    const pendingN = collectOpenTaskOccurrences(template.id, occurrences).length;
    const msg =
      pendingN > 0
        ? `ลบกติกา "${template.title}" ถาวร?\nรอบที่ยังไม่ส่ง ${pendingN} รายการจะถูกลบ\nประวัติที่ส่งแล้วยังอยู่`
        : `ลบกติกา "${template.title}" ถาวร?`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    onError("");
    try {
      const result = await purgeTaskTemplate(template, occurrences);
      onSaved({
        deleted: true,
        templateId: template.id,
        periodKeys: result.periodKeys,
      });
    } catch (err) {
      onError((err as Error).message || "ลบกติกาไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop edit-modal is-module-form is-tasks-form" onClick={onClose}>
      <div className="modal-card tasks-form-card" onClick={(e) => e.stopPropagation()}>
        <form className="form-card entry-form module-entry-form tasks-entry-form" onSubmit={(e) => void onSubmit(e)}>
          <div className="entry-toolbar module-form-head">
            <h2 className="panel-title">{isEdit ? "แก้กติกา" : "มอบหมาย"}</h2>
            <button type="button" className="ghost-btn icon-btn" aria-label="ปิด" disabled={busy} onClick={onClose}>
              <X size={18} />
            </button>
          </div>

          {!isEdit ? (
            <div className="tasks-presets">
              <span className="field-label">ด่วน</span>
              <div className="suggest-list">
                {TASK_PRESETS.map((p) => (
                  <button key={p.title} type="button" className="suggest-chip" onClick={() => applyPreset(p)}>
                    {p.title}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="field">
            <label htmlFor="task-title">ชื่อ</label>
            <input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="เช่น ทำหมั่นโถว"
              required
            />
          </div>

          <div className="field">
            <span className="field-label">ชนิด</span>
            <div className="suggest-list">
              <button
                type="button"
                className={nudgeKind === "task" ? "suggest-chip is-active" : "suggest-chip"}
                onClick={() => setNudgeKind("task")}
              >
                งานส่ง
              </button>
              <button
                type="button"
                className={nudgeKind === "soft" ? "suggest-chip is-active" : "suggest-chip"}
                onClick={() => setNudgeKind("soft")}
              >
                แจ้งเบา
              </button>
              <button
                type="button"
                className={nudgeKind === "deadline" ? "suggest-chip is-active" : "suggest-chip"}
                onClick={() => setNudgeKind("deadline")}
              >
                มีกำหนด
              </button>
            </div>
            <p className="muted form-hint-inline">
              {nudgeKind === "task"
                ? "ส่งรูป/จบได้"
                : nudgeKind === "soft"
                  ? "รับทราบวันนี้ · พรุ่งนี้ขึ้นใหม่"
                  : "งานส่ง · มีวันครบ · ส่งรูป/จบได้"}
            </p>
          </div>

          <div className="field">
            <span className="field-label">วันครบ (ซ้ำทุกสัปดาห์)</span>
            <div className="suggest-list">
              {WEEKDAY_LABELS.map((label, idx) => (
                <button
                  key={label}
                  type="button"
                  className={weekday === idx ? "suggest-chip is-active" : "suggest-chip"}
                  onClick={() => setWeekday(idx)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="muted form-hint-inline">
              ครั้งเดียว — ใส่วันที่ในรายละเอียด แล้วปิดกติกาหลังครบ
            </p>
          </div>

          <div className="field">
            <span className="field-label">
              มอบให้ ({selected.length}/{employees.length})
            </span>
            <div className="suggest-list">
              <button
                type="button"
                className={
                  employees.length > 0 && selected.length === employees.length
                    ? "suggest-chip is-active"
                    : "suggest-chip"
                }
                onClick={selectAllWorkers}
                disabled={!employees.length}
              >
                ทุกคน
              </button>
              {selected.length ? (
                <button type="button" className="suggest-chip" onClick={clearWorkers}>
                  ล้าง
                </button>
              ) : null}
              {employees.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  className={selected.includes(w.id) ? "suggest-chip is-active" : "suggest-chip"}
                  onClick={() => toggleWorker(w.id)}
                >
                  {w.name}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label htmlFor="task-note">รายละเอียด</label>
            <input
              id="task-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="เช่น ไม่เกิน 20 ก.ย. · ปรึกษาเพื่อนก่อนทำ"
            />
          </div>

          <div className="entry-actions module-form-actions">
            <button type="submit" className="primary-btn" disabled={busy || !employees.length}>
              {busy ? "บันทึก..." : isEdit ? "บันทึก" : "สร้าง"}
            </button>
            <button type="button" className="ghost-btn" disabled={busy} onClick={onClose}>
              ออก
            </button>
          </div>
          {isEdit ? (
            <button
              type="button"
              className="ghost-btn tasks-delete-template-btn"
              disabled={busy}
              onClick={() => void onDeleteTemplate()}
            >
              <Trash2 size={14} aria-hidden /> ลบถาวร
            </button>
          ) : null}
        </form>
      </div>
    </div>
  );
}

function SubmitOccurrenceModal({
  occ,
  actorId,
  employeeId = "",
  authorName,
  authorRole,
  isOwner,
  onError,
  onClose,
  onSaved,
}: {
  occ: TaskOccurrence;
  actorId: string;
  employeeId?: string;
  authorName: string;
  authorRole: "owner" | "staff";
  isOwner: boolean;
  onError: (msg: string) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [imageUrls, setImageUrls] = useState<string[]>(() => getTaskProofImgs(occ));
  const [completionNote, setCompletionNote] = useState(occ.completionNote || "");
  const [outcome, setOutcome] = useState<"done" | "waiting">(
    occ.status === "waiting" ? "waiting" : "done",
  );
  const [noteDraft, setNoteDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [noteBusy, setNoteBusy] = useState(false);
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);

  const progressNotes = occ.progressNotes || [];

  async function onPostNote(e?: FormEvent) {
    e?.preventDefault();
    if (!actorId || noteBusy) return;
    setNoteBusy(true);
    onError("");
    try {
      await addTaskProgressNote(occ, {
        text: noteDraft,
        createdBy: actorId,
        createdByName: authorName,
        authorRole,
      });
      setNoteDraft("");
    } catch (err) {
      onError((err as Error).message || "โพสต์โนตไม่สำเร็จ");
    } finally {
      setNoteBusy(false);
    }
  }

  async function onDeleteNote(noteId: string) {
    if (!window.confirm("ลบโนตนี้?")) return;
    setDeletingNoteId(noteId);
    onError("");
    try {
      await deleteTaskProgressNote(occ, noteId);
    } catch (err) {
      onError((err as Error).message || "ลบโนตไม่สำเร็จ");
    } finally {
      setDeletingNoteId(null);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!actorId) return;
    const urls = imageUrls.filter(Boolean).slice(0, TASK_PROOF_MAX);
    if (urls.some((u) => u.startsWith("data:"))) {
      onError("รูปเก่ายังฝังในเอกสาร — ลบแล้วแนบใหม่เพื่อบันทึกเข้าคลังหลักฐาน");
      return;
    }

    if (outcome === "waiting") {
      if (!(completionNote || "").trim()) {
        onError("ใส่ข้อความสถานะ เช่น ส่งซ่อมแล้ว กำลังรอร้าน");
        return;
      }
      setBusy(true);
      onError("");
      try {
        await reportTaskOccurrenceWaiting(occ, {
          checklistDone: occ.checklistDone || [],
          proofImgs: urls,
          proofImg: urls[0] || "",
          completionNote,
          completedBy: actorId,
        });
        onSaved();
      } catch (err) {
        onError((err as Error).message || "บันทึกสถานะรอไม่สำเร็จ");
      } finally {
        setBusy(false);
      }
      return;
    }

    // แจ้งเตือน soft/deadline — รับทราบวันนี้เท่านั้น · ไม่ complete
    if (isNotifyOnlyNudge(occ.nudgeKind)) {
      setBusy(true);
      onError("");
      try {
        acknowledgeNotifyToday(occ.id);
        if (employeeId) {
          await reportTaskNotifyAck(occ, {
            employeeId,
            employeeName: authorName,
          });
        }
        onSaved();
      } catch (err) {
        onError((err as Error).message || "บันทึกรับทราบไม่สำเร็จ");
      } finally {
        setBusy(false);
      }
      return;
    }

    const validation = validateTaskCompleteInput({
      proofImgs: urls,
      requireProof: false,
    });
    if (validation) {
      onError(validation);
      return;
    }
    setBusy(true);
    onError("");
    try {
      await completeTaskOccurrence(occ, {
        checklistDone: occ.checklistDone || [],
        proofImgs: urls,
        proofImg: urls[0] || "",
        completionNote,
        completedBy: actorId,
      });
      onSaved();
    } catch (err) {
      onError((err as Error).message || "ส่งงานไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  const notifyOnly = isNotifyOnlyNudge(occ.nudgeKind);
  const canSubmitDone = true;
  const canSubmitWaiting = !!(completionNote || "").trim();
  const title =
    occ.status === "missed"
      ? notifyOnly
        ? "รับทราบวันนี้"
        : "ส่งย้อนหลัง"
      : occ.status === "waiting"
        ? "อัปเดตงานที่รอ"
        : notifyOnly
          ? "รับทราบวันนี้"
          : "ส่งงาน";

  return (
    <div className="modal-backdrop edit-modal is-module-form is-tasks-form" onClick={onClose}>
      <div className="modal-card tasks-form-card" onClick={(e) => e.stopPropagation()}>
        <form className="form-card entry-form module-entry-form tasks-entry-form" onSubmit={(e) => void onSubmit(e)}>
          <div className="entry-toolbar module-form-head">
            <h2 className="panel-title">{title}</h2>
            <button type="button" className="ghost-btn icon-btn" aria-label="ปิด" disabled={busy} onClick={onClose}>
              <X size={18} />
            </button>
          </div>

          <p className="tasks-form-slot-bar">{occ.title}</p>
          <p className="muted form-hint-inline">
            {notifyOnly
              ? `รอบ ${formatDateShortBe(occ.dueDate)} — แจ้งเตือน · รับทราบวันนี้แล้ว พรุ่งนี้ขึ้นใหม่ · ไม่ใช่ส่งงาน`
              : `รอบ ${formatDateShortBe(occ.dueDate)} — โนตความคืบแทนเช็คลิสย่อย · แล้วค่อยจบงานหรือรายงานว่ารออยู่`}
          </p>

          <div className="field tasks-progress-notes">
            <span className="field-label">โนตความคืบ</span>
            <ul className="tasks-progress-list">
              {progressNotes.length === 0 ? (
                <li className="muted tasks-progress-empty">ยังไม่มีโนต — พิมพ์ความคืบด้านล่าง</li>
              ) : (
                progressNotes.map((n) => {
                  const canDelete =
                    isOwner || (!!actorId && n.createdBy === actorId);
                  return (
                    <li
                      key={n.id}
                      className={
                        n.authorRole === "owner"
                          ? "tasks-progress-item is-owner"
                          : "tasks-progress-item is-staff"
                      }
                    >
                      <div className="tasks-progress-meta">
                        <span className="tasks-progress-who">
                          {n.authorRole === "owner" ? "เจ้าของ" : "พนักงาน"} ·{" "}
                          {n.createdByName || "—"}
                        </span>
                        <span className="tasks-progress-when">
                          {n.createdAt ? formatDateTimeShortBe(n.createdAt) : ""}
                        </span>
                      </div>
                      <p className="tasks-progress-text">{n.text}</p>
                      {canDelete ? (
                        <button
                          type="button"
                          className="ghost-btn tasks-progress-del"
                          disabled={deletingNoteId === n.id || noteBusy || busy}
                          onClick={() => void onDeleteNote(n.id)}
                          aria-label="ลบโนต"
                        >
                          ×
                        </button>
                      ) : null}
                    </li>
                  );
                })
              )}
            </ul>
            <div className="tasks-progress-compose">
              <textarea
                className="tasks-completion-note"
                rows={2}
                maxLength={TASK_PROGRESS_NOTE_MAX}
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder={
                  isOwner
                    ? "พิมพ์ข้อความถึงพนักงาน…"
                    : "ใส่ข้อความแสดงความคืบหน้า…"
                }
                disabled={noteBusy || busy}
              />
              <button
                type="button"
                className="primary-btn tasks-progress-send"
                disabled={noteBusy || busy || !noteDraft.trim()}
                onClick={() => void onPostNote()}
              >
                <Send size={14} aria-hidden />
                {noteBusy ? "กำลังส่ง…" : "ส่งโนต"}
              </button>
            </div>
          </div>

          <div className="field">
            <span className="field-label">ผลตอนนี้</span>
            <div className="suggest-list">
              <button
                type="button"
                className={outcome === "done" ? "suggest-chip is-active" : "suggest-chip"}
                onClick={() => setOutcome("done")}
              >
                จบงาน
              </button>
              <button
                type="button"
                className={outcome === "waiting" ? "suggest-chip is-active" : "suggest-chip"}
                onClick={() => setOutcome("waiting")}
              >
                ส่งแล้ว รอผล
              </button>
            </div>
            <p className="muted form-hint-inline">
              {outcome === "waiting"
                ? "หยุดแจ้งเตือน · ข้อความค้างในตารางหลังร้านจนกว่าจะจบ"
                : notifyOnly
                  ? "รับทราบวันนี้เท่านั้น · พรุ่งนี้ขึ้นใหม่ · ไม่ถือว่าส่งงาน"
                  : "แนบรูปได้ถ้าต้องการ · ปิดรอบนี้"}
            </p>
          </div>

          {notifyOnly && outcome === "done" ? null : (
          <PhotoAttachMultiField
            values={imageUrls}
            onChange={setImageUrls}
            onError={onError}
            label="รูป (ไม่บังคับ)"
            max={TASK_PROOF_MAX}
            storageFolder="tasks"
            storageSlotKey="proof"
            hint={`สูงสุด ${TASK_PROOF_MAX} รูป · แจ้งเตือนไม่บังคับแนบรูป`}
          />
          )}

          {notifyOnly && outcome === "done" ? null : (
          <label className="field">
            <span className="field-label">
              {outcome === "waiting"
                ? "สรุปตอนส่ง/รอ (บังคับ)"
                : "ข้อความเพิ่ม (ไม่บังคับ)"}
            </span>
            <textarea
              className="tasks-completion-note"
              rows={2}
              maxLength={280}
              value={completionNote}
              onChange={(e) => setCompletionNote(e.target.value)}
              placeholder="เช่น ส่งซ่อมแล้ว กำลังรออะไหล่"
              disabled={busy}
            />
          </label>
          )}

          <div className="entry-actions module-form-actions">
            <button
              type="submit"
              className="primary-btn"
              disabled={
                busy || (outcome === "waiting" ? !canSubmitWaiting : !canSubmitDone)
              }
            >
              {busy
                ? "กำลังบันทึก..."
                : outcome === "waiting"
                  ? "บันทึกว่ากำลังรอ"
                  : notifyOnly
                    ? "รับทราบวันนี้"
                    : "ส่งงานจบ"}
            </button>
            <button type="button" className="ghost-btn" disabled={busy} onClick={onClose}>
              ออก
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
