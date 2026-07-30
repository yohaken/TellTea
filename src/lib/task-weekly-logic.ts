import type { TaskChecklistItem, TaskOccurrence, TaskTemplate } from "./task-types";

export const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_OPEN_DAYS_BEFORE = 3;
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

export const WEEKDAY_LABELS = [
  "อาทิตย์",
  "จันทร์",
  "อังคาร",
  "พุธ",
  "พฤหัส",
  "ศุกร์",
  "เสาร์",
] as const;

/** ย่อวันสำหรับแถบกติกากะทัดรัด */
export const WEEKDAY_SHORT_LABELS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"] as const;

export type CompletedKind = "on_time" | "late" | "backfill";
export type OccurrenceTab = "thisWeek" | "missed" | "history";

const WEEKDAY_SHORT: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** ปฏิทิน Asia/Bangkok — ไม่พึ่ง timezone ของเครื่อง/เซิร์ฟเวอร์ */
export function bangkokCalendarParts(ms: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value || "";
  return {
    y: Number(get("year")),
    m: Number(get("month")),
    d: Number(get("day")),
    weekday: WEEKDAY_SHORT[get("weekday")] ?? 0,
  };
}

/** เที่ยงคืนวันนั้นตามปฏิทินไทย (Asia/Bangkok) เป็น epoch ms */
export function startOfLocalDay(ms: number) {
  const { y, m, d } = bangkokCalendarParts(ms);
  return Date.UTC(y, m - 1, d) - BANGKOK_OFFSET_MS;
}

export function periodKeyFromDue(dueDate: number) {
  const { y, m, d } = bangkokCalendarParts(dueDate);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** doc id คงที่ กัน client+CF สร้างซ้ำ */
export function occurrenceDocId(templateId: string, periodKey: string) {
  const tid = String(templateId || "").trim();
  const pk = String(periodKey || "").trim();
  return `${tid}_${pk}`;
}

export function labelWeekday(weekday: number) {
  return WEEKDAY_LABELS[weekday] ?? `วัน ${weekday}`;
}

export function labelWeekdayShort(weekday: number) {
  return WEEKDAY_SHORT_LABELS[weekday] ?? String(weekday);
}

/** วันรับผิดชอบของสัปดาห์ที่มี `ms` (ปฏิทินไทย) */
export function dueDateForWeekContaining(ms: number, weekday: number) {
  const todayStart = startOfLocalDay(ms);
  const todayDay = bangkokCalendarParts(ms).weekday;
  const daysBack = (todayDay - weekday + 7) % 7;
  return todayStart - daysBack * DAY_MS;
}

export function openAtForDue(dueDate: number, openDaysBefore = DEFAULT_OPEN_DAYS_BEFORE) {
  return startOfLocalDay(dueDate) - openDaysBefore * DAY_MS;
}

export function shouldMarkMissed(
  dueDate: number,
  now: number,
  openDaysBefore = DEFAULT_OPEN_DAYS_BEFORE,
) {
  const nextDue = dueDate + 7 * DAY_MS;
  return now >= openAtForDue(nextDue, openDaysBefore);
}

/**
 * รอบที่ต้องมีในระบบ: เฉพาะรอบที่เปิดส่งแล้ว และยังไม่พ้นเกณฑ์พลาด
 * → ไม่สร้างรอบสัปดาห์ก่อนเป็น "พลาด" ทันทีตอนสร้างกติกาใหม่
 */
export function dueDatesToEnsure(now: number, weekday: number, openDaysBefore: number) {
  const currentDue = dueDateForWeekContaining(now, weekday);
  const candidates = [currentDue, currentDue + 7 * DAY_MS];
  const out: number[] = [];
  for (const due of candidates) {
    if (now < openAtForDue(due, openDaysBefore)) continue;
    if (shouldMarkMissed(due, now, openDaysBefore)) continue;
    out.push(due);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

export function isPeriodDismissed(
  template: Pick<TaskTemplate, "dismissedPeriodKeys">,
  periodKey: string,
) {
  return (template.dismissedPeriodKeys || []).includes(periodKey);
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
  nudgeKind: import("./task-types").TaskNudgeKind;
};

export type SyncMissedOp = { occurrenceId: string };
export type SyncDeleteOp = { occurrenceId: string };

function statusRank(status: string) {
  if (status === "completed") return 3;
  if (status === "missed") return 2;
  return 1;
}

function preferOccurrence(a: TaskOccurrence, b: TaskOccurrence) {
  const ideal = occurrenceDocId(a.templateId, a.periodKey);
  if (a.id === ideal && b.id !== ideal) return -1;
  if (b.id === ideal && a.id !== ideal) return 1;
  const sr = statusRank(b.status) - statusRank(a.status);
  if (sr) return sr;
  return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
}

export function computeSyncOperations(
  templates: TaskTemplate[],
  occurrences: TaskOccurrence[],
  now = Date.now(),
) {
  const deleteDupes: SyncDeleteOp[] = [];
  const groups = new Map<string, TaskOccurrence[]>();
  for (const occ of occurrences) {
    const key = `${occ.templateId}:${occ.periodKey}`;
    const arr = groups.get(key) || [];
    arr.push(occ);
    groups.set(key, arr);
  }

  const byKey = new Map<string, TaskOccurrence>();
  for (const [key, group] of groups) {
    if (group.length === 1) {
      byKey.set(key, group[0]!);
      continue;
    }
    const sorted = [...group].sort(preferOccurrence);
    const keep = sorted[0]!;
    byKey.set(key, keep);
    for (let i = 1; i < sorted.length; i++) {
      deleteDupes.push({ occurrenceId: sorted[i]!.id });
    }
  }

  const create: SyncCreateOp[] = [];
  const markMissed: SyncMissedOp[] = [];
  const missedIds = new Set<string>();
  const deletedIds = new Set(deleteDupes.map((d) => d.occurrenceId));

  function pushMissed(id: string) {
    if (!id || missedIds.has(id) || deletedIds.has(id)) return;
    missedIds.add(id);
    markMissed.push({ occurrenceId: id });
  }

  for (const tpl of templates) {
    if (!tpl.active) continue;
    const openDays = tpl.openDaysBefore ?? DEFAULT_OPEN_DAYS_BEFORE;
    const dues = dueDatesToEnsure(now, tpl.weekday, openDays);
    const ensuredKeys = new Set(dues.map((due) => periodKeyFromDue(due)));

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
          nudgeKind: tpl.nudgeKind === "soft" ? "soft" : "deadline",
        });
      }
    }

    const openPending: TaskOccurrence[] = [];
    for (const occ of occurrences) {
      if (occ.templateId !== tpl.id) continue;
      if (deletedIds.has(occ.id)) continue;
      if (occ.status !== "pending") continue;
      if (shouldMarkMissed(occ.dueDate, now, openDays)) {
        pushMissed(occ.id);
        continue;
      }
      openPending.push(occ);
    }

    // ค้างเปิดได้แค่ 1 รอบต่อกติกา — เก็บรอบที่อยู่ใน ensured / due ล่าสุด
    if (openPending.length > 1) {
      const preferred = openPending.filter((o) => ensuredKeys.has(o.periodKey));
      const pool = preferred.length ? preferred : openPending;
      pool.sort((a, b) => b.dueDate - a.dueDate || (b.updatedAt || 0) - (a.updatedAt || 0));
      const keepId = pool[0]!.id;
      for (const occ of openPending) {
        if (occ.id !== keepId) pushMissed(occ.id);
      }
    }
  }

  return { create, markMissed, deleteDupes };
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

  // สัปดาห์นี้ / ค้างเปิด — การ์ดเดียวต่อกติกา
  const open = sorted.filter((o) => {
    if (o.status !== "pending") return false;
    return !shouldMarkMissed(o.dueDate, now, openDaysFromOcc(o));
  });
  const byTpl = new Map<string, TaskOccurrence>();
  for (const o of open) {
    const prev = byTpl.get(o.templateId);
    if (
      !prev ||
      o.dueDate > prev.dueDate ||
      (o.dueDate === prev.dueDate && (o.updatedAt || 0) > (prev.updatedAt || 0))
    ) {
      byTpl.set(o.templateId, o);
    }
  }
  return [...byTpl.values()].sort((a, b) => b.dueDate - a.dueDate || b.updatedAt - a.updatedAt);
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
