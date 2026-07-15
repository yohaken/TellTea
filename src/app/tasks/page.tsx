"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  CalendarClock,
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
import { listActiveEmployees, type Employee } from "@/lib/employees";
import { isAppOwnerEmail } from "@/lib/firebase";
import { completeTaskOccurrence, deleteTaskOccurrences, subscribeTaskOccurrences, subscribeTaskOccurrencesForAssignee, syncPendingOccurrencesFromTemplate } from "@/lib/task-occurrences";
import {
  createTaskTemplate,
  deactivateTaskTemplate,
  deleteTaskTemplate,
  dismissTaskPeriod,
  subscribeTaskTemplates,
  updateTaskTemplate,
} from "@/lib/task-templates";
import { runTaskOccurrenceSync } from "@/lib/task-sync";
import type { TaskChecklistItem, TaskOccurrence, TaskTemplate } from "@/lib/task-types";
import {
  canSubmitOccurrence,
  filterOccurrencesByTab,
  getTaskProofImgs,
  isOccurrenceOpenSoon,
  labelCompletedKind,
  labelWeekday,
  newChecklistItemId,
  TASK_PROOF_MAX,
  validateTaskCompleteInput,
  WEEKDAY_LABELS,
  type OccurrenceTab,
} from "@/lib/task-weekly-logic";
import { formatDateShort } from "@/lib/utils";

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
  const syncedRef = useRef(false);

  const doSync = useCallback(async (tpls: TaskTemplate[], occs: TaskOccurrence[]) => {
    setSyncing(true);
    try {
      await runTaskOccurrenceSync(tpls, occs);
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
            ? "ประจำวันในสัปดาห์ · ส่งได้ทุกวัน · เจ้าของแก้ไข/ปิด/ลบกติกาได้"
            : "งานที่มอบให้คุณ · ส่ง checklist + รูปหลักฐานเมื่อครบ"}
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
            <div className="tasks-template-bar">
              <span className="field-label">กติกาที่เปิดอยู่</span>
              <div className="tasks-template-chips">
                {activeTemplates.map((tpl) => (
                  <span key={tpl.id} className="tasks-template-chip">
                    {tpl.title} · ทุก{labelWeekday(tpl.weekday)}
                    <button
                      type="button"
                      className="tasks-template-edit"
                      aria-label="แก้ไขกติกา"
                      onClick={() => setEditingTemplate(tpl)}
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      type="button"
                      className="tasks-template-off"
                      aria-label="ปิดกติกา"
                      onClick={() => {
                        if (!window.confirm(`ปิดกติกา "${tpl.title}"? รอบใหม่จะไม่ถูกสร้าง`)) return;
                        void deactivateTaskTemplate(tpl.id).catch((err) =>
                          setError((err as Error).message || "ปิดกติกาไม่สำเร็จ"),
                        );
                      }}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
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
            <ul className="tasks-list">
              {visible.map((occ) => (
                <OccurrenceCard
                  key={occ.id}
                  occ={occ}
                  canManage={isOwnerManager}
                  onSubmit={() => setSubmitOcc(occ)}
                  onViewPhoto={(urls) => setPreviewUrls(urls)}
                  onError={setError}
                />
              ))}
            </ul>
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
          onSaved={async () => {
            setEditingTemplate(null);
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

function OccurrenceCard({
  occ,
  canManage,
  onSubmit,
  onViewPhoto,
  onError,
}: {
  occ: TaskOccurrence;
  canManage: boolean;
  onSubmit: () => void;
  onViewPhoto: (urls: string[]) => void;
  onError: (msg: string) => void;
}) {
  const soon = isOccurrenceOpenSoon(occ);
  const canSubmit = canSubmitOccurrence(occ);
  const done = occ.status === "completed";
  const missed = occ.status === "missed";
  const canDelete = canManage && !done;
  const proofImgs = getTaskProofImgs(occ);

  async function onDelete() {
    if (!window.confirm(`ลบรอบงาน "${occ.title}" (${formatDateShort(occ.dueDate)})?`)) return;
    try {
      await dismissTaskPeriod(occ.templateId, occ.periodKey);
      await deleteTaskOccurrences([occ.id]);
    } catch (err) {
      onError((err as Error).message || "ลบรอบงานไม่สำเร็จ");
    }
  }

  return (
    <li
      className={
        done
          ? "tasks-card is-done"
          : missed
            ? "tasks-card is-overdue"
            : soon
              ? "tasks-card is-future"
              : "tasks-card"
      }
    >
      <div className="tasks-card-head">
        <div>
          <h2 className="tasks-card-title">{occ.title}</h2>
          <p className="tasks-card-meta">
            <CalendarClock size={12} aria-hidden />             รอบ {formatDateShort(occ.dueDate)} · ทุก{labelWeekday(new Date(occ.dueDate).getDay())}
          </p>
          <p className="tasks-card-workers">{occ.assigneeNames.join(", ")}</p>
        </div>
        <span
          className={`tasks-status-pill ${
            done ? "is-done" : missed ? "is-overdue" : soon ? "is-future" : "is-pending"
          }`}
        >
          {done
            ? labelCompletedKind(occ.completedKind || "on_time")
            : missed
              ? "พลาด"
              : soon
                ? "ยังไม่เปิดส่ง"
                : "ค้างส่ง"}
        </span>
      </div>

      {occ.note ? <p className="tasks-card-note">{occ.note}</p> : null}

      <ul className="tasks-check-preview">
        {occ.checklist.map((item) => {
          const checked = done ? occ.checklistDone.includes(item.id) : false;
          return (
            <li key={item.id} className={checked ? "is-checked" : ""}>
              {checked ? <CheckCircle2 size={14} /> : <Circle size={14} />}
              <span>{item.label}</span>
            </li>
          );
        })}
      </ul>

      <div className="tasks-card-actions">
        {canSubmit ? (
          <button type="button" className="primary-btn tasks-submit-btn" onClick={onSubmit}>
            <Camera size={16} aria-hidden /> {missed ? "ส่งย้อนหลัง" : "ส่งงาน"}
          </button>
        ) : null}
        {soon ? (
          <p className="muted tasks-future-hint">เปิดส่ง {formatDateShort(occ.openAt)}</p>
        ) : null}
        {done && proofImgs.length ? (
          <button
            type="button"
            className="ghost-btn tasks-proof-btn"
            onClick={() => onViewPhoto(proofImgs)}
          >
            <ImageIcon size={14} aria-hidden /> ดูรูปหลักฐาน
            {proofImgs.length > 1 ? ` (${proofImgs.length})` : ""}
          </button>
        ) : null}
        {canDelete ? (
          <button type="button" className="ghost-btn tasks-delete-btn" onClick={() => void onDelete()}>
            <Trash2 size={14} aria-hidden /> ลบรอบ
          </button>
        ) : null}
      </div>
    </li>
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
  onSaved: () => void;
}) {
  const isEdit = !!template;
  const [title, setTitle] = useState(template?.title || "");
  const [note, setNote] = useState(template?.note || "");
  const [weekday, setWeekday] = useState(template?.weekday ?? 1);
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
    };
    setBusy(true);
    onError("");
    try {
      if (isEdit && template) {
        await updateTaskTemplate(template.id, payload);
        const pendingIds = occurrences
          .filter(
            (o) =>
              o.templateId === template.id &&
              (o.status === "pending" || o.status === "missed"),
          )
          .map((o) => o.id);
        if (pendingIds.length) {
          await syncPendingOccurrencesFromTemplate(
            {
              templateId: template.id,
              title: payload.title.trim(),
              note: (payload.note || "").trim(),
              checklist: steps,
              assigneeIds: payload.assigneeIds,
              assigneeNames: payload.assigneeNames,
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
    const pendingIds = occurrences
      .filter(
        (o) =>
          o.templateId === template.id &&
          (o.status === "pending" || o.status === "missed"),
      )
      .map((o) => o.id);
    const msg =
      pendingIds.length > 0
        ? `ลบกติกา "${template.title}" ถาวร?\nรอบที่ยังไม่ส่ง ${pendingIds.length} รายการจะถูกลบ\nประวัติที่ส่งแล้วยังอยู่`
        : `ลบกติกา "${template.title}" ถาวร?`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    onError("");
    try {
      if (pendingIds.length) {
        for (const id of pendingIds) {
          const occ = occurrences.find((o) => o.id === id);
          if (occ) await dismissTaskPeriod(occ.templateId, occ.periodKey);
        }
        await deleteTaskOccurrences(pendingIds);
      }
      await deleteTaskTemplate(template.id);
      onSaved();
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
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [imageUrls, setImageUrls] = useState<string[]>([]);
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

  return (
    <div className="modal-backdrop edit-modal is-module-form is-tasks-form" onClick={onClose}>
      <div className="modal-card tasks-form-card" onClick={(e) => e.stopPropagation()}>
        <form className="form-card entry-form module-entry-form tasks-entry-form" onSubmit={(e) => void onSubmit(e)}>
          <div className="entry-toolbar module-form-head">
            <h2 className="panel-title">{occ.status === "missed" ? "ส่งย้อนหลัง" : "ส่งงาน"}</h2>
            <button type="button" className="ghost-btn icon-btn" aria-label="ปิด" disabled={busy} onClick={onClose}>
              <X size={18} />
            </button>
          </div>

          <p className="tasks-form-slot-bar">{occ.title}</p>
          <p className="muted form-hint-inline">
            รอบ {formatDateShort(occ.dueDate)} — ติ๊กทุกข้อ แล้วแนบรูปหลักฐาน
          </p>

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
            label="รูปหลักฐาน (บังคับ)"
            max={TASK_PROOF_MAX}
            storageFolder="tasks"
            storageSlotKey="proof"
            hint={`บันทึกหลักฐานเข้าฐานข้อมูล · สูงสุด ${TASK_PROOF_MAX} รูป`}
          />

          <div className="entry-actions module-form-actions">
            <button type="submit" className="primary-btn" disabled={busy || !allDone || !imageUrls.length}>
              {busy ? "กำลังส่ง..." : "ส่งงาน"}
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
