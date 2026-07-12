/**
 * Weekly task occurrence sync — shared logic for Cloud Functions.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_OPEN_DAYS_BEFORE = 3;

function startOfLocalDay(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function periodKeyFromDue(dueDate) {
  const d = new Date(startOfLocalDay(dueDate));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dueDateForWeekContaining(ms, weekday) {
  const todayStart = startOfLocalDay(ms);
  const todayDay = new Date(todayStart).getDay();
  const daysBack = (todayDay - weekday + 7) % 7;
  return todayStart - daysBack * DAY_MS;
}

function openAtForDue(dueDate, openDaysBefore = DEFAULT_OPEN_DAYS_BEFORE) {
  return startOfLocalDay(dueDate) - openDaysBefore * DAY_MS;
}

function dueDatesToEnsure(now, weekday, openDaysBefore) {
  const currentDue = dueDateForWeekContaining(now, weekday);
  const candidates = [currentDue - 7 * DAY_MS, currentDue, currentDue + 7 * DAY_MS];
  const out = [];
  for (const due of candidates) {
    if (now >= openAtForDue(due, openDaysBefore)) out.push(due);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

function shouldMarkMissed(dueDate, now, openDaysBefore = DEFAULT_OPEN_DAYS_BEFORE) {
  const nextDue = dueDate + 7 * DAY_MS;
  return now >= openAtForDue(nextDue, openDaysBefore);
}

function computeSyncOperations(templates, occurrences, now = Date.now()) {
  const byKey = new Map();
  for (const occ of occurrences) {
    byKey.set(`${occ.templateId}:${occ.periodKey}`, occ);
  }

  const create = [];
  const markMissed = [];
  const missedIds = new Set();

  for (const tpl of templates) {
    if (tpl.active === false) continue;
    const openDays = tpl.openDaysBefore ?? DEFAULT_OPEN_DAYS_BEFORE;
    const dues = dueDatesToEnsure(now, tpl.weekday, openDays);

    for (const dueDate of dues) {
      const periodKey = periodKeyFromDue(dueDate);
      const key = `${tpl.id}:${periodKey}`;
      if (!byKey.has(key)) {
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

    for (const occ of occurrences) {
      if (occ.templateId !== tpl.id) continue;
      if (occ.status !== "pending") continue;
      if (shouldMarkMissed(occ.dueDate, now, openDays) && !missedIds.has(occ.id)) {
        missedIds.add(occ.id);
        markMissed.push({ occurrenceId: occ.id });
      }
    }
  }

  return { create, markMissed };
}

async function runSyncWithAdmin(db) {
  const now = Date.now();
  const tplSnap = await db.collection("taskTemplates").where("active", "==", true).get();
  const templates = tplSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (!templates.length) return { created: 0, markedMissed: 0 };

  const occSnap = await db.collection("taskOccurrences").get();
  const occurrences = occSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const { create, markMissed } = computeSyncOperations(templates, occurrences, now);

  let batch = db.batch();
  let ops = 0;
  const commit = async () => {
    if (ops > 0) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  };

  for (const op of create) {
    const ref = db.collection("taskOccurrences").doc();
    batch.set(ref, {
      templateId: op.templateId,
      periodKey: op.periodKey,
      title: op.title,
      note: op.note,
      checklist: op.checklist,
      assigneeIds: op.assigneeIds,
      assigneeNames: op.assigneeNames,
      dueDate: op.dueDate,
      openAt: op.openAt,
      status: "pending",
      checklistDone: [],
      proofImg: "",
      createdAt: now,
      updatedAt: now,
    });
    ops += 1;
    if (ops >= 400) await commit();
  }

  for (const op of markMissed) {
    batch.update(db.collection("taskOccurrences").doc(op.occurrenceId), {
      status: "missed",
      updatedAt: now,
    });
    ops += 1;
    if (ops >= 400) await commit();
  }

  await commit();
  return { created: create.length, markedMissed: markMissed.length };
}

module.exports = { runSyncWithAdmin };
