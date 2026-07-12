"use client";

import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  Camera,
  CheckCircle2,
  Circle,
  ImageIcon,
  ListTodo,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { ImagePreviewModal } from "@/components/EntryPhotoCell";
import { ModuleTabDock } from "@/components/ModuleTabDock";
import { PhotoAttachField } from "@/components/PhotoAttachField";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { useAuth } from "@/lib/auth";
import {
  canStaffCompleteTask,
  isAssignTaskFuture,
  labelAssignRecurrence,
  newChecklistItemId,
  sortAssignTasks,
  startOfLocalDay,
  todayStartMs,
  validateTaskCompleteInput,
} from "@/lib/assign-tasks-logic";
import {
  completeAssignTask,
  createAssignTask,
  deleteAssignTask,
  subscribeAllAssignTasks,
  subscribeAssignTasksForEmployee,
  type AssignChecklistItem,
  type AssignTask,
  type AssignTaskRecurrence,
} from "@/lib/assign-tasks";
import { listActiveEmployees, type Employee } from "@/lib/employees";
import { can } from "@/lib/permissions";
import {
  formatDateShort,
  parseDateInput,
  todayInputValue,
} from "@/lib/utils";

type ViewFilter = "pending" | "done" | "all";

const TASK_PRESETS: { title: string; recurrence: AssignTaskRecurrence; checklist: string[] }[] = [
  {
    title: "โพสต์ Facebook ประจำสัปดาห์",
    recurrence: "weekly",
    checklist: ["ออกแบบภาพ/ข้อความ", "โพสต์แล้ว", "แคปหน้าจอโพสต์"],
  },
  {
    title: "คอนเทนต์รายเดือน",
    recurrence: "monthly",
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
  const { actorId, staff } = useAuth();
  const router = useRouter();
  const isOwner = staff?.role === "owner";
  const myEmployeeId = staff?.employeeId || "";

  const [tasks, setTasks] = useState<AssignTask[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ViewFilter>("pending");
  const [createOpen, setCreateOpen] = useState(false);
  const [submitTask, setSubmitTask] = useState<AssignTask | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (staff && !can(staff, "assignTasks")) {
      router.replace("/ledger/");
    }
  }, [staff, router]);

  useEffect(() => {
    if (!can(staff, "assignTasks")) return;
    setLoading(true);
    let employeesReady = false;
    let tasksReady = false;
    const finishLoading = () => {
      if (employeesReady && tasksReady) setLoading(false);
    };

    void listActiveEmployees()
      .then(setEmployees)
      .catch((err) => setError((err as Error).message || "โหลดรายชื่อไม่สำเร็จ"))
      .finally(() => {
        employeesReady = true;
        finishLoading();
      });

    if (!isOwner && !myEmployeeId) {
      setTasks([]);
      tasksReady = true;
      finishLoading();
      return;
    }

    const onRows = (rows: AssignTask[]) => {
      setTasks(rows);
      if (!tasksReady) {
        tasksReady = true;
        finishLoading();
      }
    };

    const unsub = isOwner
      ? subscribeAllAssignTasks(onRows, (err) => setError(err.message || "โหลดงานไม่สำเร็จ"))
      : subscribeAssignTasksForEmployee(
          myEmployeeId,
          onRows,
          (err) => setError(err.message || "โหลดงานไม่สำเร็จ"),
        );

    return unsub;
  }, [staff, isOwner, myEmployeeId]);

  useBodyScrollLock(createOpen || !!submitTask || !!previewUrl);

  const visible = useMemo(() => {
    let rows = sortAssignTasks(tasks);
    if (filter === "pending") rows = rows.filter((t) => t.status === "pending");
    if (filter === "done") rows = rows.filter((t) => t.status === "completed");
    return rows;
  }, [tasks, filter]);

  const pendingCount = tasks.filter((t) => t.status === "pending").length;

  if (!can(staff, "assignTasks")) return null;

  return (
    <div className="module-page tasks-page">
      <div className="module-page-head">
        <h1 className="panel-title module-page-title">
          <ListTodo size={18} aria-hidden />
          งานมอบหมาย
        </h1>
        <p className="muted tasks-page-hint">
          {isOwner
            ? "มอบหมายงาน · ตรวจรูปหลักฐานเมื่อพนักงานส่ง"
            : "งานของคุณ — ติ๊ก checklist แล้วแนบรูปก่อนส่ง"}
        </p>
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading && !isOwner && !myEmployeeId ? (
        <p className="tasks-link-banner">
          เชื่อมชื่อกับรายชื่อร้านที่{" "}
          <a href="/profile/" style={{ fontWeight: 700 }}>
            โปรไฟล์
          </a>{" "}
          ก่อนรับงาน
        </p>
      ) : null}

      {!loading ? (
        <>
          <div className="tasks-filter-bar">
            <button
              type="button"
              className={filter === "pending" ? "tasks-filter is-active" : "tasks-filter"}
              onClick={() => setFilter("pending")}
            >
              ค้างส่ง {pendingCount ? `(${pendingCount})` : ""}
            </button>
            <button
              type="button"
              className={filter === "done" ? "tasks-filter is-active" : "tasks-filter"}
              onClick={() => setFilter("done")}
            >
              เสร็จแล้ว
            </button>
            {isOwner ? (
              <button
                type="button"
                className={filter === "all" ? "tasks-filter is-active" : "tasks-filter"}
                onClick={() => setFilter("all")}
              >
                ทั้งหมด
              </button>
            ) : null}
          </div>

          {!visible.length ? (
            <p className="empty">
              {filter === "done" ? "ยังไม่มีงานที่ส่งแล้ว" : "ไม่มีงานค้าง — รอเจ้าของมอบหมาย"}
            </p>
          ) : (
            <ul className="tasks-list">
              {visible.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  isOwner={isOwner}
                  onSubmit={() => setSubmitTask(task)}
                  onViewPhoto={(url) => setPreviewUrl(url)}
                  onDelete={async () => {
                    if (!window.confirm("ลบงานนี้?")) return;
                    try {
                      await deleteAssignTask(task.id);
                    } catch (err) {
                      setError((err as Error).message || "ลบไม่สำเร็จ");
                    }
                  }}
                />
              ))}
            </ul>
          )}
        </>
      ) : null}

      {createOpen ? (
        <CreateTaskModal
          employees={employees}
          actorId={actorId}
          onError={setError}
          onClose={() => setCreateOpen(false)}
          onSaved={() => setCreateOpen(false)}
        />
      ) : null}

      {submitTask ? (
        <SubmitTaskModal
          task={submitTask}
          actorId={actorId}
          onError={setError}
          onClose={() => setSubmitTask(null)}
          onSaved={() => setSubmitTask(null)}
        />
      ) : null}

      {previewUrl ? (
        <ImagePreviewModal url={previewUrl} title="หลักฐานงาน" onClose={() => setPreviewUrl(null)} />
      ) : null}

      {isOwner ? (
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

function TaskCard({
  task,
  isOwner,
  onSubmit,
  onViewPhoto,
  onDelete,
}: {
  task: AssignTask;
  isOwner: boolean;
  onSubmit: () => void;
  onViewPhoto: (url: string) => void;
  onDelete: () => void;
}) {
  const future = isAssignTaskFuture(task);
  const canSubmit = canStaffCompleteTask(task);
  const done = task.status === "completed";
  const overdue = !done && !future && startOfLocalDay(task.dueDate) < todayStartMs();

  return (
    <li
      className={
        done
          ? "tasks-card is-done"
          : future
            ? "tasks-card is-future"
            : overdue
              ? "tasks-card is-overdue"
              : "tasks-card"
      }
    >
      <div className="tasks-card-head">
        <div>
          <h2 className="tasks-card-title">{task.title}</h2>
          <p className="tasks-card-meta">
            <CalendarClock size={12} aria-hidden /> ส่ง {formatDateShort(task.dueDate)} ·{" "}
            {labelAssignRecurrence(task.recurrence)}
          </p>
          <p className="tasks-card-workers">{task.assigneeNames.join(", ")}</p>
        </div>
        <span className={`tasks-status-pill ${done ? "is-done" : future ? "is-future" : "is-pending"}`}>
          {done ? "ส่งแล้ว" : future ? "ยังไม่ถึงกำหนด" : "ค้างส่ง"}
        </span>
      </div>

      {task.note ? <p className="tasks-card-note">{task.note}</p> : null}

      <ul className="tasks-check-preview">
        {task.checklist.map((item) => {
          const checked = done ? task.checklistDone.includes(item.id) : false;
          return (
            <li key={item.id} className={checked ? "is-checked" : ""}>
              {checked ? <CheckCircle2 size={14} /> : <Circle size={14} />}
              <span>{item.label}</span>
            </li>
          );
        })}
      </ul>

      <div className="tasks-card-actions">
        {!isOwner && canSubmit ? (
          <button type="button" className="primary-btn tasks-submit-btn" onClick={onSubmit}>
            <Camera size={16} aria-hidden /> ส่งงาน
          </button>
        ) : null}
        {!isOwner && future ? (
          <p className="muted tasks-future-hint">เปิดส่งได้ตั้งแต่วันกำหนด</p>
        ) : null}
        {done && task.proofImg ? (
          <button
            type="button"
            className="ghost-btn tasks-proof-btn"
            onClick={() => onViewPhoto(task.proofImg!)}
          >
            <ImageIcon size={14} aria-hidden /> ดูรูปหลักฐาน
          </button>
        ) : null}
        {isOwner && !done ? (
          <button type="button" className="trash-btn" aria-label="ลบ" onClick={() => void onDelete()}>
            <Trash2 size={14} />
          </button>
        ) : null}
      </div>
    </li>
  );
}

function CreateTaskModal({
  employees,
  actorId,
  onError,
  onClose,
  onSaved,
}: {
  employees: Employee[];
  actorId: string;
  onError: (msg: string) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [due, setDue] = useState(todayInputValue());
  const [recurrence, setRecurrence] = useState<AssignTaskRecurrence>("once");
  const [selected, setSelected] = useState<string[]>([]);
  const [checklist, setChecklist] = useState<AssignChecklistItem[]>([
    { id: newChecklistItemId(), label: "" },
  ]);
  const [busy, setBusy] = useState(false);

  function applyPreset(preset: (typeof TASK_PRESETS)[number]) {
    setTitle(preset.title);
    setRecurrence(preset.recurrence);
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
    setBusy(true);
    onError("");
    try {
      await createAssignTask({
        title,
        note,
        assigneeIds: chosen.map((w) => w.id),
        assigneeNames: chosen.map((w) => w.name),
        dueDate: parseDateInput(due),
        recurrence,
        checklist: steps,
        assignedBy: actorId,
        createdBy: actorId,
      });
      onSaved();
    } catch (err) {
      onError((err as Error).message || "สร้างงานไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop edit-modal is-module-form is-tasks-form" onClick={onClose}>
      <div className="modal-card tasks-form-card" onClick={(e) => e.stopPropagation()}>
        <form className="form-card entry-form module-entry-form tasks-entry-form" onSubmit={(e) => void onSubmit(e)}>
          <div className="entry-toolbar module-form-head">
            <h2 className="panel-title">มอบหมายงาน</h2>
            <button type="button" className="ghost-btn icon-btn" aria-label="ปิด" disabled={busy} onClick={onClose}>
              <X size={18} />
            </button>
          </div>

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

          <div className="stock-form-grid">
            <div className="field">
              <label htmlFor="task-due">กำหนดส่ง</label>
              <input id="task-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="task-rec">ความถี่</label>
              <select
                id="task-rec"
                value={recurrence}
                onChange={(e) => setRecurrence(e.target.value as AssignTaskRecurrence)}
              >
                <option value="once">ครั้งเดียว</option>
                <option value="weekly">รายสัปดาห์</option>
                <option value="monthly">รายเดือน</option>
              </select>
            </div>
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
              {busy ? "กำลังบันทึก..." : "มอบหมาย"}
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

function SubmitTaskModal({
  task,
  actorId,
  onError,
  onClose,
  onSaved,
}: {
  task: AssignTask;
  actorId: string;
  onError: (msg: string) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [imageUrl, setImageUrl] = useState("");
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
    const validation = validateTaskCompleteInput({
      checklist: task.checklist,
      checkedIds,
      proofImg: imageUrl,
    });
    if (validation) {
      onError(validation);
      return;
    }
    setBusy(true);
    onError("");
    try {
      await completeAssignTask(task.id, {
        checklistDone: checkedIds,
        proofImg: imageUrl,
        completedBy: actorId,
      });
      onSaved();
    } catch (err) {
      onError((err as Error).message || "ส่งงานไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  const allDone = task.checklist.every((c) => checked.has(c.id));

  return (
    <div className="modal-backdrop edit-modal is-module-form is-tasks-form" onClick={onClose}>
      <div className="modal-card tasks-form-card" onClick={(e) => e.stopPropagation()}>
        <form className="form-card entry-form module-entry-form tasks-entry-form" onSubmit={(e) => void onSubmit(e)}>
          <div className="entry-toolbar module-form-head">
            <h2 className="panel-title">ส่งงาน</h2>
            <button type="button" className="ghost-btn icon-btn" aria-label="ปิด" disabled={busy} onClick={onClose}>
              <X size={18} />
            </button>
          </div>

          <p className="tasks-form-slot-bar">{task.title}</p>
          <p className="muted form-hint-inline">ติ๊กทุกข้อ แล้วแนบรูปหลักฐาน (จอโพสต์ / งานที่ทำ)</p>

          <ul className="tasks-check-submit">
            {task.checklist.map((item) => {
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

          <PhotoAttachField value={imageUrl} onChange={setImageUrl} onError={onError} label="รูปหลักฐาน (บังคับ)" />

          <div className="entry-actions module-form-actions">
            <button type="submit" className="primary-btn" disabled={busy || !allDone || !imageUrl}>
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
