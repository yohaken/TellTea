/**
 * Weekly task occurrence sync — shared logic for Cloud Functions.
 * Day math pinned to Asia/Bangkok (matches schedule timezone).
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_OPEN_DAYS_BEFORE = 3;
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

const WEEKDAY_SHORT = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function bangkokCalendarParts(ms) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(new Date(ms));
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  return {
    y: Number(get("year")),
    m: Number(get("month")),
    d: Number(get("day")),
    weekday: WEEKDAY_SHORT[get("weekday")] ?? 0,
  };
}

function startOfLocalDay(ms) {
  const { y, m, d } = bangkokCalendarParts(ms);
  return Date.UTC(y, m - 1, d) - BANGKOK_OFFSET_MS;
}

function periodKeyFromDue(dueDate) {
  const { y, m, d } = bangkokCalendarParts(dueDate);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function occurrenceDocId(templateId, periodKey) {
  return `${String(templateId || "").trim()}_${String(periodKey || "").trim()}`;
}

function dueDateForWeekContaining(ms, weekday) {
  const todayStart = startOfLocalDay(ms);
  const todayDay = bangkokCalendarParts(ms).weekday;
  const daysBack = (todayDay - weekday + 7) % 7;
  return todayStart - daysBack * DAY_MS;
}

function openAtForDue(dueDate, openDaysBefore = DEFAULT_OPEN_DAYS_BEFORE) {
  return startOfLocalDay(dueDate) - openDaysBefore * DAY_MS;
}

function shouldMarkMissed(dueDate, now, openDaysBefore = DEFAULT_OPEN_DAYS_BEFORE) {
  const nextDue = dueDate + 7 * DAY_MS;
  return now >= openAtForDue(nextDue, openDaysBefore);
}

function dueDatesToEnsure(now, weekday, openDaysBefore) {
  const currentDue = dueDateForWeekContaining(now, weekday);
  const candidates = [currentDue, currentDue + 7 * DAY_MS];
  const out = [];
  for (const due of candidates) {
    if (now < openAtForDue(due, openDaysBefore)) continue;
    if (shouldMarkMissed(due, now, openDaysBefore)) continue;
    out.push(due);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

function isPeriodDismissed(template, periodKey) {
  const keys = template.dismissedPeriodKeys;
  return Array.isArray(keys) && keys.includes(periodKey);
}

function statusRank(status) {
  if (status === "completed") return 3;
  if (status === "missed") return 2;
  return 1;
}

function preferOccurrence(a, b) {
  const ideal = occurrenceDocId(a.templateId, a.periodKey);
  if (a.id === ideal && b.id !== ideal) return -1;
  if (b.id === ideal && a.id !== ideal) return 1;
  const sr = statusRank(b.status) - statusRank(a.status);
  if (sr) return sr;
  return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
}

function computeSyncOperations(templates, occurrences, now = Date.now()) {
  const deleteDupes = [];
  const groups = new Map();
  for (const occ of occurrences) {
    const key = `${occ.templateId}:${occ.periodKey}`;
    const arr = groups.get(key) || [];
    arr.push(occ);
    groups.set(key, arr);
  }

  const byKey = new Map();
  for (const [key, group] of groups) {
    if (group.length === 1) {
      byKey.set(key, group[0]);
      continue;
    }
    const sorted = [...group].sort(preferOccurrence);
    const keep = sorted[0];
    byKey.set(key, keep);
    for (let i = 1; i < sorted.length; i++) {
      deleteDupes.push({ occurrenceId: sorted[i].id });
    }
  }

  const create = [];
  const markMissed = [];
  const missedIds = new Set();
  const deletedIds = new Set(deleteDupes.map((d) => d.occurrenceId));

  function pushMissed(id) {
    if (!id || missedIds.has(id) || deletedIds.has(id)) return;
    missedIds.add(id);
    markMissed.push({ occurrenceId: id });
  }

  for (const tpl of templates) {
    if (tpl.active === false) continue;
    const openDays = tpl.openDaysBefore ?? DEFAULT_OPEN_DAYS_BEFORE;
    const dues = dueDatesToEnsure(now, tpl.weekday, openDays);
    const ensuredKeys = new Set(dues.map((due) => periodKeyFromDue(due)));

    const hasWaiting = occurrences.some(
      (o) =>
        o.templateId === tpl.id &&
        o.status === "waiting" &&
        !deletedIds.has(o.id),
    );

    if (!hasWaiting) {
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
            note: tpl.note || "",
            checklist: tpl.checklist || [],
            assigneeIds: tpl.assigneeIds || [],
            assigneeNames: tpl.assigneeNames || [],
          });
        }
      }
    }

    const openPending = [];
    for (const occ of occurrences) {
      if (occ.templateId !== tpl.id) continue;
      if (deletedIds.has(occ.id)) continue;
      if (occ.status === "waiting") {
        openPending.push(occ);
        continue;
      }
      if (occ.status !== "pending") continue;
      if (shouldMarkMissed(occ.dueDate, now, openDays)) {
        pushMissed(occ.id);
        continue;
      }
      openPending.push(occ);
    }

    if (openPending.length > 1) {
      const waiting = openPending.filter((o) => o.status === "waiting");
      let keepId;
      if (waiting.length) {
        waiting.sort(
          (a, b) => b.dueDate - a.dueDate || (b.updatedAt || 0) - (a.updatedAt || 0),
        );
        keepId = waiting[0].id;
      } else {
        const preferred = openPending.filter((o) => ensuredKeys.has(o.periodKey));
        const pool = preferred.length ? preferred : openPending;
        pool.sort(
          (a, b) => b.dueDate - a.dueDate || (b.updatedAt || 0) - (a.updatedAt || 0),
        );
        keepId = pool[0].id;
      }
      for (const occ of openPending) {
        if (occ.id === keepId) continue;
        if (occ.status === "waiting") continue;
        pushMissed(occ.id);
      }
    }
  }

  return { create, markMissed, deleteDupes };
}

async function runSyncWithAdmin(db) {
  // ยกเลิกระบบ checklist / งานมอบหมายรอบสัปดาห์ — ใช้กระดานโนต taskBoardNotes แทน
  void db;
  return { created: 0, markedMissed: 0, deletedDupes: 0, cancelled: true };
}

module.exports = {
  runSyncWithAdmin,
  computeSyncOperations,
  dueDatesToEnsure,
  startOfLocalDay,
  periodKeyFromDue,
};
