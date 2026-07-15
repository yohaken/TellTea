import type { TaskChecklistItem, TaskOccurrence, TaskTemplate } from "./task-types";

export const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_OPEN_DAYS_BEFORE = 3;

export const WEEKDAY_LABELS = [
  "อาทิตย์",
  "จันทร์",
  "อังคาร",
  "พุธ",
  "พฤหัส",
  "ศุกร์",
  "เสาร์",
] as const;

export type CompletedKind = "on_time" | "late" | "backfill";
export type OccurrenceTab = "thisWeek" | "missed" | "history";

export function startOfLocalDay(ms: number) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function periodKeyFromDue(dueDate: number) {
  const d = new Date(startOfLocalDay(dueDate));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function labelWeekday(weekday: number) {
  return WEEKDAY_LABELS[weekday] ?? `วัน ${weekday}`;
}

/** วันรับผิดชอบของสัปดาห์ที่มี `ms` */
export function dueDateForWeekContaining(ms: number, weekday: number) {
  const todayStart = startOfLocalDay(ms);
  const todayDay = new Date(todayStart).getDay();
  const daysBack = (todayDay - weekday + 7) % 7;
  return todayStart - daysBack * DAY_MS;
}

export function openAtForDue(dueDate: number, openDaysBefore = DEFAULT_OPEN_DAYS_BEFORE) {
  return startOfLocalDay(dueDate) - openDaysBefore * DAY_MS;
}

export function dueDatesToEnsure(now: number, weekday: number, openDaysBefore: number) {
  const currentDue = dueDateForWeekContaining(now, weekday);
  // สร้างแค่สัปดาห์นี้ + สัปดาห์หน้า — ไม่ย้อนสร้างสัปดาห์เก่าซ้ำหลังลบ
  const candidates = [currentDue, currentDue + 7 * DAY_MS];
  const out: number[] = [];
  for (const due of candidates) {
    if (now >= openAtForDue(due, openDaysBefore)) out.push(due);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

export function isPeriodDismissed(
  template: Pick<TaskTemplate, "dismissedPeriodKeys">,
  periodKey: string,
) {
  return (template.dismissedPeriodKeys || []).includes(periodKey);
}

export function shouldMarkMissed(
  dueDate: number,
  now: number,
  openDaysBefore = DEFAULT_OPEN_DAYS_BEFORE,
) {
  const nextDue = dueDate + 7 * DAY_MS;
  return now >= openAtForDue(nextDue, openDaysBefore);
}

export function computeCompletedKind(
  dueDate: number,
  completedAt: number,
  wasMissed: boolean,
): CompletedKind {
  if (wasMissed) return "backfill";
  if (startOfLocalDay(completedAt) <= startOfLocalDay(dueDate)) return "on_time";
  return "late";
}

export function labelCompletedKind(kind: CompletedKind) {
  if (kind === "on_time") return "ตรงเวลา";
  if (kind === "late") return "ส่งช้า";
  return "ย้อนหลัง";
}

export function canSubmitOccurrence(
  occ: Pick<TaskOccurrence, "status" | "openAt">,
  now = Date.now(),
) {
  if (occ.status === "completed") return false;
  if (occ.status === "missed") return true;
  return now >= occ.openAt;
}

export function isOccurrenceOpenSoon(
  occ: Pick<TaskOccurrence, "status" | "openAt">,
  now = Date.now(),
) {
  if (occ.status !== "pending") return false;
  return now < occ.openAt;
}

export type SyncCreateOp = {
  templateId: string;
  periodKey: string;
  dueDate: number;
  openAt: number;
  title: string;
  note: string;
  checklist: TaskChecklistItem[];
  assigneeIds: string[];
  assigneeNames: string[];
};

export type SyncMissedOp = { occurrenceId: string };

export function computeSyncOperations(
  templates: TaskTemplate[],
  occurrences: TaskOccurrence[],
  now = Date.now(),
) {
  const byKey = new Map<string, TaskOccurrence>();
  for (const occ of occurrences) {
    byKey.set(`${occ.templateId}:${occ.periodKey}`, occ);
  }

  const create: SyncCreateOp[] = [];
  const markMissed: SyncMissedOp[] = [];

  for (const tpl of templates) {
    if (!tpl.active) continue;
    const openDays = tpl.openDaysBefore ?? DEFAULT_OPEN_DAYS_BEFORE;
    const dues = dueDatesToEnsure(now, tpl.weekday, openDays);

    for (const dueDate of dues) {
      const periodKey = periodKeyFromDue(dueDate);
      const key = `${tpl.id}:${periodKey}`;
      if (!byKey.has(key) && !isPeriodDismissed(tpl, periodKey)) {
        create.push({
          templateId: tpl.id,
          periodKey,
          dueDate,
          openAt: openAtForDue(dueDate, openDays),
          title: tpl.title,
          note: tpl.note,
          checklist: tpl.checklist,
          assigneeIds: tpl.assigneeIds,
          assigneeNames: tpl.assigneeNames,
        });
      }
    }

    for (const occ of occurrences) {
      if (occ.templateId !== tpl.id) continue;
      if (occ.status !== "pending") continue;
      if (shouldMarkMissed(occ.dueDate, now, openDays)) {
        markMissed.push({ occurrenceId: occ.id });
      }
    }
  }

  return { create, markMissed };
}

export function openDaysFromOcc(occ: Pick<{ dueDate: number; openAt: number }, "dueDate" | "openAt">) {
  const days = Math.round((startOfLocalDay(occ.dueDate) - startOfLocalDay(occ.openAt)) / DAY_MS);
  return Math.max(1, days);
}

export function filterOccurrencesByTab(
  rows: TaskOccurrence[],
  tab: OccurrenceTab,
  now = Date.now(),
) {
  const sorted = [...rows].sort((a, b) => b.dueDate - a.dueDate || b.updatedAt - a.updatedAt);

  if (tab === "history") {
    return sorted.filter((o) => o.status === "completed");
  }

  if (tab === "missed") {
    const cutoff = now - 4 * 7 * DAY_MS;
    return sorted.filter((o) => {
      if (o.dueDate < cutoff) return false;
      if (o.status === "missed") return true;
      if (o.status === "pending") {
        return shouldMarkMissed(o.dueDate, now, openDaysFromOcc(o));
      }
      return false;
    });
  }

  return sorted.filter((o) => {
    if (o.status !== "pending") return false;
    return !shouldMarkMissed(o.dueDate, now, openDaysFromOcc(o));
  });
}

export type DisciplineRow = {
  assigneeId: string;
  assigneeName: string;
  onTime: number;
  late: number;
  backfill: number;
  missed: number;
  total: number;
};

export function buildDisciplineReport(
  occurrences: TaskOccurrence[],
  weeks = 4,
  now = Date.now(),
) {
  const since = now - weeks * 7 * DAY_MS;
  const recent = occurrences.filter((o) => o.dueDate >= since - 7 * DAY_MS);
  const map = new Map<string, DisciplineRow>();

  for (const occ of recent) {
    for (let i = 0; i < occ.assigneeIds.length; i++) {
      const assigneeId = occ.assigneeIds[i];
      const assigneeName = occ.assigneeNames[i] || assigneeId;
      const row =
        map.get(assigneeId) ||
        ({
          assigneeId,
          assigneeName,
          onTime: 0,
          late: 0,
          backfill: 0,
          missed: 0,
          total: 0,
        } satisfies DisciplineRow);
      row.total += 1;
      if (occ.status === "completed" && occ.completedKind === "on_time") row.onTime += 1;
      else if (occ.status === "completed" && occ.completedKind === "late") row.late += 1;
      else if (occ.status === "completed" && occ.completedKind === "backfill") row.backfill += 1;
      else if (occ.status === "missed") row.missed += 1;
      map.set(assigneeId, row);
    }
  }

  return [...map.values()].sort((a, b) => a.assigneeName.localeCompare(b.assigneeName, "th"));
}

export function newChecklistItemId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `chk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function validateTaskCompleteInput(input: {
  checklist: TaskChecklistItem[];
  checkedIds: string[];
  proofImg?: string;
  proofImgs?: string[];
}): string | null {
  const proofs = [
    ...(input.proofImgs || []),
    ...(input.proofImg ? [input.proofImg] : []),
  ]
    .map((u) => u.trim())
    .filter(Boolean);
  if (!proofs.length) return "แนบรูปหลักฐานก่อนส่งงาน";
  const set = new Set(input.checkedIds);
  if (!input.checklist.every((item) => set.has(item.id))) {
    return "ติ๊ก checklist ให้ครบทุกข้อก่อนส่ง";
  }
  return null;
}

export const TASK_PROOF_MAX = 6;

export function getTaskProofImgs(occ?: {
  proofImg?: string;
  proofImgs?: string[];
} | null): string[] {
  if (!occ) return [];
  if (Array.isArray(occ.proofImgs) && occ.proofImgs.length) {
    return occ.proofImgs.map(String).filter((u) => u.trim()).slice(0, TASK_PROOF_MAX);
  }
  const legacy = (occ.proofImg || "").trim();
  return legacy ? [legacy] : [];
}
