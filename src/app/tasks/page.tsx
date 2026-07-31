"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Camera,
  CheckCircle2,
  Circle,
  ImageIcon,
  ListTodo,
  Pencil,
  Plus,
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
import {
  collectOpenTaskOccurrences,
  completeTaskOccurrence,
  deactivateTaskTemplateClearingOpen,
  dismissAndDeleteOpenTaskOccurrences,
  isOpenTaskOccurrenceStatus,
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
  buildOwnerTaskTimeline,
  type OwnerTimelineRow,
} from "@/lib/task-owner-timeline";
import type { TaskChecklistItem, TaskOccurrence, TaskTemplate } from "@/lib/task-types";
import {
  applyDismissBlocksToTemplates,
  bangkokCalendarParts,
  canSubmitOccurrence,
  filterOccurrencesByTab,
  getTaskProofImgs,
  isOccurrenceOpenSoon,
  labelCompletedKind,
  labelWeekday,
  labelWeekdayShort,
  mergeDismissedPeriodKeys,
  newChecklistItemId,
  TASK_PROOF_MAX,
  validateTaskCompleteInput,
  WEEKDAY_LABELS,
  type OccurrenceTab,
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

const TASK_PRESETS: { title: string; weekday: number; checklist: string[] }[] = [
  {
    title: "โพสต์ Facebook ประจำสัปดาห์",
    weekday: 1,
    checklist: ["ออกแบบภาพ/ข้อความ", "โพสต์แล้ว", "แคปหน้าจอโพสต์"],
  },
  {
    title: "คอนเทนต์รายเดือน",
    weekday: 1,
    checklist: ["ร่างคอนเทนต์", "อนุมัติแล้ว", "เผยแพร่แล้ว", "แนบรูปหลักฐาน"],
  },
];

export default function TasksPage() {
  return (
    <AuthGate>
      <TasksView />
    </AuthGate>
  );
}

function TasksView() {
  const { actorId, staff, user } = useAuth();
  const isOwnerManager = staff?.role === "owner" || isAppOwnerEmail(user?.email);
  const myEmployeeId = staff?.employeeId || "";

  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [occurrences, setOccurrences] = useState<TaskOccurrence[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<OccurrenceTab>("thisWeek");
  const [createOpen, setCreateOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<TaskTemplate | null>(null);
  const [submitOcc, setSubmitOcc] = useState<TaskOccurrence | null>(null);
  const [previewUrls, setPreviewUrls] = useState<string[] | null>(null);
  /** แถบกติกาพับได้ — ค่าเริ่ม: เปิดถ้า ≤2, เยอะแล้วพับ */
  const [rulesOpen, setRulesOpen] = useState(false);
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

  const visible = useMemo(() => filterOccurrencesByTab(occurrences, tab), [occurrences, tab]);
  const activeTemplates = useMemo(() => templates.filter((t) => t.active), [templates]);

  useEffect(() => {
    if (rulesInitRef.current || loading) return;
    if (!isOwnerManager) return;
    rulesInitRef.current = true;
    setRulesOpen(activeTemplates.length <= 2);
  }, [loading, isOwnerManager, activeTemplates.length]);

  const thisWeekCount = filterOccurrencesByTab(occurrences, "thisWeek").length;
  const missedCount = filterOccurrencesByTab(occurrences, "missed").length;

  if (!staff) return null;

  return (
    <div className="module-page tasks-page">
      <div className="module-page-head">
        <h1 className="panel-title module-page-title">
          <ListTodo size={18} aria-hidden />
          งานมอบหมาย
        </h1>
        <p className="muted tasks-page-hint">
          {isOwnerManager
            ? "กติกา = งานซ้ำทุกสัปดาห์ · ตารางด้านล่าง = รอบที่ต้องทำตอนนี้ · เอาออก = หายจากตารางทันที · ปิดกติกา = หยุดงานประจำ"
            : "ติ๊ก checklist ให้ครบ แล้วส่งพร้อมรูป · ใส่ข้อความถึงเจ้าของได้"}
        </p>
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
                  <span className="muted tasks-template-toggle-hint">
                    {" "}
                    · ปิด=หยุด+เอาออกจากตาราง · ลบ=ถาวร
                  </span>
                </span>
                <span className="tasks-template-toggle-meta" aria-hidden>
                  {rulesOpen
                    ? "ย่อ"
                    : activeTemplates
                        .slice(0, 4)
                        .map((t) => labelWeekdayShort(t.weekday))
                        .join("·") + (activeTemplates.length > 4 ? "…" : "")}
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
                          title="หยุดงานประจำ + เอาออกจากตารางทันที"
                          onClick={() => {
                            const openN = collectOpenTaskOccurrences(
                              tpl.id,
                              occurrences,
                            ).length;
                            const msg =
                              openN > 0
                                ? `ปิดกติกา "${tpl.title}"?\nรอบที่ยังไม่ส่ง ${openN} รายการจะหายจากตาราง\nไม่สร้างรอบใหม่`
                                : `ปิดกติกา "${tpl.title}"?\nไม่สร้างรอบใหม่`;
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
                                // อย่า reset syncedRef — sync ซ้ำด้วย template เก่าจะสร้างรอบกลับ
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
                                ? `ลบกติกา "${tpl.title}" ถาวร?\nรอบที่ยังไม่ส่ง ${pendingN} รายการจะถูกลบ\nประวัติที่ส่งแล้วยังอยู่`
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
            <OwnerTaskTimeline
              rows={buildOwnerTaskTimeline(occurrences)}
              onViewPhoto={(urls) => setPreviewUrls(urls)}
            />
          ) : null}

          <div className="tasks-filter-bar">
            <button
              type="button"
              className={tab === "thisWeek" ? "tasks-filter is-active" : "tasks-filter"}
              onClick={() => setTab("thisWeek")}
            >
              สัปดาห์นี้ {thisWeekCount ? `(${thisWeekCount})` : ""}
            </button>
            <button
              type="button"
              className={tab === "missed" ? "tasks-filter is-active" : "tasks-filter"}
              onClick={() => setTab("missed")}
            >
              ค้าง/พลาด {missedCount ? `(${missedCount})` : ""}
            </button>
            <button
              type="button"
              className={tab === "history" ? "tasks-filter is-active" : "tasks-filter"}
              onClick={() => setTab("history")}
            >
              ประวัติ
            </button>
          </div>

          {!visible.length ? (
            <p className="empty">
              {tab === "history"
                ? "ยังไม่มีงานที่ส่งแล้ว"
                : tab === "missed"
                  ? "ไม่มีงานค้างหรือพลาด"
                  : isOwnerManager
                    ? "ไม่มีรอบสัปดาห์นี้ — กด + มอบหมาย เพื่อสร้างกติกา"
                    : "ยังไม่มีงานมอบให้คุณในสัปดาห์นี้"}
            </p>
          ) : (
            <OccurrencesTable
              rows={visible}
              allOccurrences={occurrences}
              employees={employees}
              canManage={isOwnerManager}
              showFeedback={tab === "history"}
              onSubmit={(occ) => setSubmitOcc(occ)}
              onViewPhoto={(urls) => setPreviewUrls(urls)}
              onError={setError}
              onDeleted={(result) => {
                rememberDismissed(result.templateId, result.periodKeys);
                const gone = new Set(result.deletedIds);
                setOccurrences((prev) => prev.filter((o) => !gone.has(o.id)));
              }}
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
          occ={submitOcc}
          actorId={actorId}
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

function statusLabel(occ: TaskOccurrence) {
  if (occ.status === "completed") return labelCompletedKind(occ.completedKind || "on_time");
  if (occ.status === "waiting") return "รออยู่";
  if (occ.status === "missed") return "พลาด";
  if (isOccurrenceOpenSoon(occ)) return "ยังไม่เปิดส่ง";
  return "ค้างส่ง";
}

function statusClass(occ: TaskOccurrence) {
  if (occ.status === "completed") return "is-done";
  if (occ.status === "waiting") return "is-waiting";
  if (occ.status === "missed") return "is-overdue";
  if (isOccurrenceOpenSoon(occ)) return "is-future";
  return "is-pending";
}

function OwnerTaskTimeline({
  rows,
  onViewPhoto,
}: {
  rows: OwnerTimelineRow[];
  onViewPhoto: (urls: string[]) => void;
}) {
  if (!rows.length) {
    return (
      <div className="tasks-owner-timeline">
        <div className="tasks-owner-timeline-head">
          <span className="tasks-owner-timeline-title">ติดตามหลังร้าน</span>
          <span className="muted tasks-owner-timeline-hint">ยังไม่มีรอบเปิดหรือประวัติส่ง</span>
        </div>
      </div>
    );
  }

  return (
    <div className="tasks-owner-timeline">
      <div className="tasks-owner-timeline-head">
        <span className="tasks-owner-timeline-title">ติดตามหลังร้าน</span>
        <span className="muted tasks-owner-timeline-hint">
          ค้าง/รอ + ส่งล่าสุด · เบา/กำหนด · ข้อความ
        </span>
      </div>
      <div className="sheet-wrap tasks-timeline-sheet sheet-bleed">
        <table className="sheet-table tasks-timeline-table sheet-table--dense">
          <thead>
            <tr>
              <th>งาน</th>
              <th>ชนิด</th>
              <th>ใคร</th>
              <th>เมื่อ</th>
              <th>สถานะ</th>
              <th>ข้อความ</th>
              <th>รูป</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className={`tasks-timeline-row is-${row.statusTone}`}
              >
                <td className="tasks-timeline-title" title={row.title}>
                  {row.title}
                </td>
                <td>
                  <span
                    className={`tasks-timeline-kind is-${row.nudgeKind}`}
                    title={row.nudgeKind === "soft" ? "แจ้งเบาๆ" : "มีกำหนด"}
                  >
                    {row.nudgeKind === "soft" ? "เบา" : "กำหนด"}
                  </span>
                </td>
                <td className="tasks-timeline-who" title={row.who}>
                  {row.who}
                </td>
                <td className="tasks-timeline-when">
                  {row.whenMs
                    ? row.isOpen
                      ? formatDateShortBe(row.whenMs)
                      : formatDateTimeShortBe(row.whenMs)
                    : "—"}
                </td>
                <td>
                  <span className={`tasks-timeline-status is-${row.statusTone}`}>
                    {row.statusLabel}
                  </span>
                </td>
                <td className="tasks-timeline-note" title={row.feedback || undefined}>
                  {row.feedback || "—"}
                </td>
                <td className="tasks-timeline-proof">
                  {row.proofUrls.length ? (
                    <button
                      type="button"
                      className="ghost-btn tasks-timeline-proof-btn"
                      onClick={() => onViewPhoto(row.proofUrls)}
                    >
                      <ImageIcon size={12} aria-hidden /> {row.proofUrls.length}
                    </button>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OccurrencesTable({
  rows,
  allOccurrences,
  employees = [],
  canManage,
  showFeedback = false,
  onSubmit,
  onViewPhoto,
  onError,
  onDeleted,
}: {
  rows: TaskOccurrence[];
  allOccurrences: TaskOccurrence[];
  employees?: Employee[];
  canManage: boolean;
  showFeedback?: boolean;
  onSubmit: (occ: TaskOccurrence) => void;
  onViewPhoto: (urls: string[]) => void;
  onError: (msg: string) => void;
  onDeleted?: (result: {
    templateId: string;
    deletedIds: string[];
    periodKeys: string[];
  }) => void;
}) {
  async function onDelete(occ: TaskOccurrence) {
    const open = collectOpenTaskOccurrences(occ.templateId, allOccurrences);
    const n = Math.max(1, open.length);
    if (
      !window.confirm(
        n > 1
          ? `เอา "${occ.title}" ออกจากตาราง?\nรอบที่ยังไม่ส่ง ${n} รายการจะหายทันที\nกติกายังอยู่ — สัปดาห์หน้าสร้างใหม่ได้`
          : `เอา "${occ.title}" ออกจากตาราง?\nกติกายังอยู่ — สัปดาห์หน้าสร้างใหม่ได้`,
      )
    ) {
      return;
    }
    try {
      const result = await dismissAndDeleteOpenTaskOccurrences(
        occ.templateId,
        allOccurrences,
      );
      onDeleted?.({
        templateId: occ.templateId,
        deletedIds: result.deletedIds.length ? result.deletedIds : [occ.id],
        periodKeys: result.periodKeys,
      });
    } catch (err) {
      onError((err as Error).message || "ลบงานไม่สำเร็จ");
    }
  }

  return (
    <div className="sheet-wrap tasks-sheet sheet-bleed">
      <table className="sheet-table tasks-table sheet-table--dense">
        <thead>
          <tr>
            <th className="tasks-col-title">งาน</th>
            <th className="tasks-col-due">รอบ</th>
            <th className="tasks-col-who">มอบให้</th>
            <th className="tasks-col-check">checklist</th>
            <th className="tasks-col-note">{showFeedback ? "feedback" : "note"}</th>
            <th className="tasks-col-status">สถานะ</th>
            <th className="tasks-col-act">ทำ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((occ) => {
            const soon = isOccurrenceOpenSoon(occ);
            const canSubmit = canSubmitOccurrence(occ);
            const done = occ.status === "completed";
            const waiting = occ.status === "waiting";
            const missed = occ.status === "missed";
            const canDelete = canManage && !done;
            const proofImgs = getTaskProofImgs(occ);
            const weekday = labelWeekday(bangkokCalendarParts(occ.dueDate).weekday);
            const noteText = waiting || showFeedback
              ? (occ.completionNote || "").trim()
              : occ.note || "";
            const checkText = occ.checklist
              .map((item) => {
                const checked =
                  done || waiting ? occ.checklistDone.includes(item.id) : false;
                return `${checked ? "✓" : "○"} ${item.label}`;
              })
              .join(" · ");

            return (
              <tr
                key={occ.id}
                className={[
                  "tasks-row",
                  done ? "is-done" : "",
                  waiting ? "is-waiting" : "",
                  missed ? "is-overdue" : "",
                  soon ? "is-future" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <td className="tasks-col-title">
                  {canSubmit ? (
                    <button
                      type="button"
                      className="tasks-title-link"
                      onClick={() => onSubmit(occ)}
                      title={waiting ? "แตะเพื่ออัปเดต/จบ" : "แตะเพื่อส่งงาน"}
                    >
                      {occ.title}
                    </button>
                  ) : (
                    <strong className="tasks-title-text">{occ.title}</strong>
                  )}
                </td>
                <td className="tasks-col-due">
                  <span className="tasks-due-main">{formatDateShortBe(occ.dueDate)}</span>
                  <span className="tasks-due-sub">ทุก{weekday}</span>
                  {soon ? (
                    <span className="tasks-due-sub">เปิด {formatDateShortBe(occ.openAt)}</span>
                  ) : null}
                </td>
                <td className="tasks-col-who">
                  {resolveWorkerDisplayNames(
                    occ.assigneeIds,
                    occ.assigneeNames,
                    employees,
                  ).join(", ") || "—"}
                </td>
                <td className="tasks-col-check" title={checkText}>
                  {checkText || "—"}
                </td>
                <td className="tasks-col-note" title={noteText || undefined}>
                  {noteText || (waiting || showFeedback ? "—" : occ.note || "—")}
                </td>
                <td className="tasks-col-status">
                  <span className={`tasks-status-pill ${statusClass(occ)}`}>{statusLabel(occ)}</span>
                </td>
                <td className="tasks-col-act">
                  <div className="tasks-act-stack">
                    {canSubmit ? (
                      <button
                        type="button"
                        className="primary-btn tasks-submit-btn"
                        onClick={() => onSubmit(occ)}
                      >
                        <Camera size={14} aria-hidden />{" "}
                        {waiting ? "อัปเดต/จบ" : missed ? "ส่งย้อนหลัง" : "ส่งงาน"}
                      </button>
                    ) : null}
                    {(done || waiting) && proofImgs.length ? (
                      <button
                        type="button"
                        className="ghost-btn tasks-proof-btn"
                        onClick={() => onViewPhoto(proofImgs)}
                      >
                        <ImageIcon size={13} aria-hidden /> รูป
                        {proofImgs.length > 1 ? ` (${proofImgs.length})` : ""}
                      </button>
                    ) : null}
                    {canDelete ? (
                      <button
                        type="button"
                        className="ghost-btn tasks-delete-btn"
                        title="เอาออกจากตารางทันที"
                        onClick={() => void onDelete(occ)}
                      >
                        <Trash2 size={13} aria-hidden /> เอาออก
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

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
  const [nudgeKind, setNudgeKind] = useState<"soft" | "deadline">(
    template?.nudgeKind === "soft" ? "soft" : "deadline",
  );
  const [selected, setSelected] = useState<string[]>(template?.assigneeIds || []);
  const [checklist, setChecklist] = useState<TaskChecklistItem[]>(
    template?.checklist.length
      ? template.checklist.map((c) => ({ ...c }))
      : [{ id: newChecklistItemId(), label: "" }],
  );
  const [busy, setBusy] = useState(false);

  function applyPreset(preset: (typeof TASK_PRESETS)[number]) {
    if (isEdit) return;
    setTitle(preset.title);
    setWeekday(preset.weekday);
    setChecklist(preset.checklist.map((label) => ({ id: newChecklistItemId(), label })));
  }

  function toggleWorker(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 3 ? prev : [...prev, id],
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!actorId) return;
    const chosen = employees.filter((w) => selected.includes(w.id));
    if (!chosen.length) {
      onError("เลือกพนักงานอย่างน้อย 1 คน");
      return;
    }
    const steps = checklist.filter((c) => c.label.trim());
    if (!steps.length) {
      onError("ต้องมี checklist อย่างน้อย 1 ข้อ");
      return;
    }
    const payload = {
      title,
      note,
      weekday,
      checklist: steps,
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
              checklist: steps,
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
            <h2 className="panel-title">{isEdit ? "แก้ไขกติกางาน" : "มอบหมายงานประจำสัปดาห์"}</h2>
            <button type="button" className="ghost-btn icon-btn" aria-label="ปิด" disabled={busy} onClick={onClose}>
              <X size={18} />
            </button>
          </div>

          {!isEdit ? (
            <div className="tasks-presets">
              <span className="field-label">แม่แบบด่วน</span>
              <div className="suggest-list">
                {TASK_PRESETS.map((p) => (
                  <button key={p.title} type="button" className="suggest-chip" onClick={() => applyPreset(p)}>
                    {p.title}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="muted form-hint-inline">
              แก้ไขมีผลกับรอบที่ยังไม่ส่ง · ประวัติที่ส่งแล้วไม่เปลี่ยน
            </p>
          )}

          <div className="field">
            <label htmlFor="task-title">ชื่องาน</label>
            <input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="โพสต์ Facebook ประจำสัปดาห์"
              required
            />
          </div>

          <div className="field">
            <span className="field-label">ชนิดเตือนพนักงาน</span>
            <div className="suggest-list">
              <button
                type="button"
                className={nudgeKind === "soft" ? "suggest-chip is-active" : "suggest-chip"}
                onClick={() => setNudgeKind("soft")}
              >
                แจ้งเบาๆ
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
              {nudgeKind === "soft"
                ? "โชว์แถบ/ป๊อปเบา · ปิดได้ · ไม่เน้นเส้นตาย"
                : "โชว์วันครบ · แถบค้างชัดจนกว่าจะส่ง"}
            </p>
          </div>

          <div className="field">
            <span className="field-label">วันรับผิดชอบประจำสัปดาห์</span>
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
            <p className="muted form-hint-inline">ส่งได้ทุกวัน (รวมล่วงหน้า) · เปิดส่งก่อน 3 วัน</p>
          </div>

          <div className="field">
            <span className="field-label">มอบให้ (สูงสุด 3)</span>
            <div className="suggest-list">
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
            <label htmlFor="task-note">รายละเอียด (ถ้ามี)</label>
            <input id="task-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="ลิงก์เพจ / ธีมโพสต์" />
          </div>

          <div className="field">
            <span className="field-label">Checklist</span>
            {checklist.map((row, idx) => (
              <div key={row.id} className="tasks-check-row">
                <input
                  value={row.label}
                  placeholder={`ขั้นตอน ${idx + 1}`}
                  onChange={(e) =>
                    setChecklist((prev) =>
                      prev.map((c) => (c.id === row.id ? { ...c, label: e.target.value } : c)),
                    )
                  }
                />
                {checklist.length > 1 ? (
                  <button
                    type="button"
                    className="ghost-btn icon-btn"
                    aria-label="ลบขั้นตอน"
                    onClick={() => setChecklist((prev) => prev.filter((c) => c.id !== row.id))}
                  >
                    <X size={14} />
                  </button>
                ) : null}
              </div>
            ))}
            <button
              type="button"
              className="ghost-btn tasks-add-step"
              onClick={() => setChecklist((prev) => [...prev, { id: newChecklistItemId(), label: "" }])}
            >
              <Plus size={14} aria-hidden /> เพิ่มขั้นตอน
            </button>
          </div>

          <div className="entry-actions module-form-actions">
            <button type="submit" className="primary-btn" disabled={busy || !employees.length}>
              {busy ? "กำลังบันทึก..." : isEdit ? "บันทึกการแก้ไข" : "สร้างกติกา"}
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
              <Trash2 size={14} aria-hidden /> ลบกติกาถาวร
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
  onError,
  onClose,
  onSaved,
}: {
  occ: TaskOccurrence;
  actorId: string;
  onError: (msg: string) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(occ.checklistDone || []),
  );
  const [imageUrls, setImageUrls] = useState<string[]>(() => getTaskProofImgs(occ));
  const [completionNote, setCompletionNote] = useState(occ.completionNote || "");
  const [outcome, setOutcome] = useState<"done" | "waiting">(
    occ.status === "waiting" ? "waiting" : "done",
  );
  const [busy, setBusy] = useState(false);

  function toggleItem(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!actorId) return;
    const checkedIds = [...checked];
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
          checklistDone: checkedIds,
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

    const validation = validateTaskCompleteInput({
      checklist: occ.checklist,
      checkedIds,
      proofImgs: urls,
    });
    if (validation) {
      onError(validation);
      return;
    }
    setBusy(true);
    onError("");
    try {
      await completeTaskOccurrence(occ, {
        checklistDone: checkedIds,
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

  const allDone = occ.checklist.every((c) => checked.has(c.id));
  const canSubmitDone = allDone && imageUrls.length > 0;
  const canSubmitWaiting = !!(completionNote || "").trim();
  const title =
    occ.status === "missed"
      ? "ส่งย้อนหลัง"
      : occ.status === "waiting"
        ? "อัปเดตงานที่รอ"
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
            รอบ {formatDateShortBe(occ.dueDate)} — เลือกจบงาน หรือรายงานว่ารออยู่ (หยุดแจ้งเตือน)
          </p>

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
                ? "หยุดป๊อป/แถบแจ้งเตือน · ข้อความค้างในตารางหลังร้านจนกว่าจะจบ"
                : "ติ๊กครบ + รูปหลักฐาน · ปิดรอบนี้"}
            </p>
          </div>

          <ul className="tasks-check-submit">
            {occ.checklist.map((item) => {
              const on = checked.has(item.id);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={on ? "tasks-check-btn is-on" : "tasks-check-btn"}
                    onClick={() => toggleItem(item.id)}
                  >
                    {on ? <CheckCircle2 size={20} /> : <Circle size={20} />}
                    <span>{item.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          <PhotoAttachMultiField
            values={imageUrls}
            onChange={setImageUrls}
            onError={onError}
            label={outcome === "waiting" ? "รูปหลักฐาน (ถ้ามี)" : "รูปหลักฐาน (บังคับ)"}
            max={TASK_PROOF_MAX}
            storageFolder="tasks"
            storageSlotKey="proof"
            hint={
              outcome === "waiting"
                ? `เช่น สลิปส่งซ่อม · สูงสุด ${TASK_PROOF_MAX} รูป`
                : `บันทึกหลักฐานเข้าฐานข้อมูล · สูงสุด ${TASK_PROOF_MAX} รูป`
            }
          />

          <label className="field">
            <span className="field-label">
              {outcome === "waiting"
                ? "ข้อความถึงเจ้าของ (บังคับ)"
                : "ข้อความถึงเจ้าของ (ไม่บังคับ)"}
            </span>
            <textarea
              className="tasks-completion-note"
              rows={2}
              maxLength={280}
              value={completionNote}
              onChange={(e) => setCompletionNote(e.target.value)}
              placeholder="เช่น ส่งซ่อมแล้ว กำลังรออะไหล่ / รับเครื่องกลับแล้ว"
              disabled={busy}
            />
          </label>

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
