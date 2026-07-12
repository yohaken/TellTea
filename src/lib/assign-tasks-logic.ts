import type { AssignTask, AssignTaskRecurrence } from "./assign-tasks";

export function startOfLocalDay(ms: number) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function todayStartMs(now = Date.now()) {
  return startOfLocalDay(now);
}

export function isAssignee(task: Pick<AssignTask, "assigneeIds">, employeeId: string) {
  if (!employeeId.trim()) return false;
  return task.assigneeIds.includes(employeeId);
}

/** ยังไม่ถึงวันส่ง */
export function isAssignTaskFuture(task: Pick<AssignTask, "dueDate" | "status">, now = Date.now()) {
  if (task.status === "completed") return false;
  return startOfLocalDay(task.dueDate) > todayStartMs(now);
}

/** พนักงานส่งงานได้เมื่อถึงกำหนดหรือเลยกำหนด */
export function canStaffCompleteTask(
  task: Pick<AssignTask, "dueDate" | "status">,
  now = Date.now(),
) {
  if (task.status !== "pending") return false;
  return startOfLocalDay(task.dueDate) <= todayStartMs(now);
}

export function filterTasksForEmployee(tasks: AssignTask[], employeeId: string) {
  if (!employeeId.trim()) return [];
  return tasks.filter((t) => isAssignee(t, employeeId));
}

export function allChecklistDone(
  checklist: AssignTask["checklist"],
  checkedIds: string[],
) {
  if (!checklist.length) return true;
  const set = new Set(checkedIds);
  return checklist.every((item) => set.has(item.id));
}

export function validateTaskCompleteInput(input: {
  checklist: AssignTask["checklist"];
  checkedIds: string[];
  proofImg: string;
}): string | null {
  if (!input.proofImg.trim()) return "แนบรูปหลักฐานก่อนส่งงาน";
  if (!allChecklistDone(input.checklist, input.checkedIds)) {
    return "ติ๊ก checklist ให้ครบทุกข้อก่อนส่ง";
  }
  return null;
}

export function labelAssignRecurrence(r: AssignTaskRecurrence) {
  if (r === "weekly") return "รายสัปดาห์";
  if (r === "monthly") return "รายเดือน";
  return "ครั้งเดียว";
}

export function sortAssignTasks(rows: AssignTask[]) {
  return [...rows].sort((a, b) => {
    if (a.status !== b.status) {
      if (a.status === "pending") return -1;
      if (b.status === "pending") return 1;
    }
    if (a.dueDate !== b.dueDate) return a.dueDate - b.dueDate;
    return b.updatedAt - a.updatedAt;
  });
}

export function newChecklistItemId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `chk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
