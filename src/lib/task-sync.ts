import type { TaskOccurrence, TaskTemplate } from "./task-types";
import { applySyncOperations } from "./task-occurrences";
import { computeSyncOperations } from "./task-weekly-logic";

export function planTaskOccurrenceSync(
  templates: TaskTemplate[],
  occurrences: TaskOccurrence[],
  now = Date.now(),
) {
  return computeSyncOperations(
    templates.filter((t) => t.active),
    occurrences,
    now,
  );
}

export async function runTaskOccurrenceSync(
  templates: TaskTemplate[],
  occurrences: TaskOccurrence[],
  now = Date.now(),
) {
  const { create, markMissed, deleteDupes } = planTaskOccurrenceSync(
    templates,
    occurrences,
    now,
  );
  await applySyncOperations(create, markMissed, deleteDupes);
  return {
    created: create.length,
    markedMissed: markMissed.length,
    deletedDupes: deleteDupes.length,
  };
}
