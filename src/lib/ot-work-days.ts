import type { OtEntry } from "./ot";
import { bangkokDateKey } from "./utils";

export type OtWorkDayRow = {
  workerId: string;
  workerName: string;
  /** Distinct Bangkok calendar days with ≥1 OT row that includes this worker */
  daysWorked: number;
  /** Full calendar days in the month (not excluding holidays yet) */
  daysInMonth: number;
};

/** Days in YYYY-MM (Gregorian). Invalid → 0. */
export function calendarDaysInMonth(ym: string): number {
  const m = String(ym || "").trim();
  if (!/^\d{4}-\d{2}$/.test(m)) return 0;
  const [ys, ms] = m.split("-").map(Number);
  if (!ys || !ms || ms < 1 || ms > 12) return 0;
  return new Date(ys, ms, 0).getDate();
}

function entryInMonth(dateMs: number, ym: string): boolean {
  const key = bangkokDateKey(dateMs);
  return Boolean(key) && key.startsWith(`${ym}-`);
}

/**
 * Count distinct OT work days per worker in a month.
 * A day counts when the person appears on ≥1 OT entry that calendar day (Bangkok).
 * Denominator = full month length (holidays not subtracted yet).
 *
 * @param roster optional active employees — included even at 0 days (transparency)
 */
export function buildOtWorkDayRows(
  entries: Pick<OtEntry, "date" | "workerIds" | "workerNames">[],
  ym: string,
  roster: { id: string; name: string }[] = [],
): OtWorkDayRow[] {
  const daysInMonth = calendarDaysInMonth(ym);
  if (!daysInMonth) return [];

  const daysById = new Map<string, Set<string>>();
  const nameById = new Map<string, string>();

  for (const emp of roster) {
    const id = String(emp.id || "").trim();
    if (!id) continue;
    daysById.set(id, new Set());
    nameById.set(id, String(emp.name || "").trim() || id);
  }

  for (const row of entries) {
    if (!entryInMonth(row.date, ym)) continue;
    const day = bangkokDateKey(row.date);
    if (!day) continue;
    const ids = row.workerIds || [];
    const names = row.workerNames || [];
    for (let i = 0; i < ids.length; i++) {
      const id = String(ids[i] || "").trim();
      if (!id) continue;
      let set = daysById.get(id);
      if (!set) {
        set = new Set();
        daysById.set(id, set);
      }
      set.add(day);
      const nm = String(names[i] || "").trim();
      if (nm && !nameById.has(id)) nameById.set(id, nm);
      else if (nm) nameById.set(id, nameById.get(id) || nm);
    }
  }

  const rows: OtWorkDayRow[] = [];
  for (const [workerId, days] of daysById) {
    rows.push({
      workerId,
      workerName: nameById.get(workerId) || workerId,
      daysWorked: days.size,
      daysInMonth,
    });
  }

  // Fewest days first — psychological nudge; then name
  rows.sort((a, b) => {
    if (a.daysWorked !== b.daysWorked) return a.daysWorked - b.daysWorked;
    return a.workerName.localeCompare(b.workerName, "th");
  });
  return rows;
}

export function findOtWorkDayRow(
  rows: OtWorkDayRow[],
  workerId: string | null | undefined,
): OtWorkDayRow | null {
  const id = String(workerId || "").trim();
  if (!id) return null;
  return rows.find((r) => r.workerId === id) || null;
}
