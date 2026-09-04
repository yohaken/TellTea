/**
 * Correlate brew (OT) + production + storefront POS sales by Bangkok day.
 * Used by the top ops chart on `/pos-sales` dashboard.
 */
import { computeOtBonus, type OtEntry, type OtShiftId } from "./ot";
import { OT_SHIFT_DISPLAY_ORDER } from "./ot-grid";
import { computeProdBonus, type ProdEntry } from "./production";
import type { PosDashDayPoint } from "./pos-sales-dashboard";
import type { PosDateRange } from "./pos-sales-report";
import { bangkokDateKey, startOfLocalDay, addLocalDays } from "./utils";

export type PosOpsShiftDay = {
  qty: number;
  bonus: number;
};

export type PosOpsDayPoint = {
  dateMs: number;
  dateKey: string;
  /** DD/MM or DD/MM/YY when range is long */
  label: string;
  /** ยอดหน้าร้าน (บาท) */
  storefrontSales: number;
  /** หน่วยชงรวม */
  brewQty: number;
  /** โบนัสชงรวม (บาท) */
  brewBonus: number;
  /** ผลิตชิ้น */
  prodQty: number;
  /** โบนัสผลิต (บาท) */
  prodBonus: number;
  byShift: Record<OtShiftId, PosOpsShiftDay>;
};

const EMPTY_SHIFT = (): Record<OtShiftId, PosOpsShiftDay> => ({
  morning: { qty: 0, bonus: 0 },
  evening: { qty: 0, bonus: 0 },
  late: { qty: 0, bonus: 0 },
});

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function labelForDay(dateMs: number, longRange: boolean): string {
  const key = bangkokDateKey(dateMs); // YYYY-MM-DD
  const [, m, d] = key.split("-");
  if (!longRange) return `${d}/${m}`;
  const y = key.slice(2, 4);
  return `${d}/${m}/${y}`;
}

/** Inclusive Bangkok midnights from range start → end (every day, zeros filled). */
export function enumeratePosRangeDays(range: PosDateRange): number[] {
  const start = startOfLocalDay(range.startMs);
  const end = startOfLocalDay(range.endMs);
  if (end < start) return [];
  const out: number[] = [];
  for (let i = 0; i < 400; i += 1) {
    const t = addLocalDays(start, i);
    if (t > end) break;
    out.push(t);
  }
  return out;
}

export function summarizeOpsCorrelationByDay(input: {
  range: PosDateRange;
  salesByDay: PosDashDayPoint[];
  otEntries: OtEntry[];
  prodEntries: ProdEntry[];
  wasteBonusPct?: number;
}): PosOpsDayPoint[] {
  const { range, salesByDay, otEntries, prodEntries } = input;
  const wasteBonusPct = Number(input.wasteBonusPct) || 0;
  const days = enumeratePosRangeDays(range);
  const longRange = days.length > 45;
  const map = new Map<string, PosOpsDayPoint>();

  for (const dateMs of days) {
    const dateKey = bangkokDateKey(dateMs);
    map.set(dateKey, {
      dateMs,
      dateKey,
      label: labelForDay(dateMs, longRange),
      storefrontSales: 0,
      brewQty: 0,
      brewBonus: 0,
      prodQty: 0,
      prodBonus: 0,
      byShift: EMPTY_SHIFT(),
    });
  }

  for (const s of salesByDay) {
    const row = map.get(s.dateKey);
    if (!row) continue;
    row.storefrontSales = round2(s.total);
  }

  for (const entry of otEntries) {
    const dateKey = bangkokDateKey(startOfLocalDay(Number(entry.date) || 0));
    const row = map.get(dateKey);
    if (!row) continue;
    const c = computeOtBonus(entry);
    const shift = (entry.shift || "morning") as OtShiftId;
    const slot = row.byShift[shift] || row.byShift.morning;
    slot.qty = round2(slot.qty + c.summaryQty);
    slot.bonus = round2(slot.bonus + c.totalBonus);
    row.brewQty = round2(row.brewQty + c.summaryQty);
    row.brewBonus = round2(row.brewBonus + c.totalBonus);
  }

  for (const entry of prodEntries) {
    const dateKey = bangkokDateKey(startOfLocalDay(Number(entry.date) || 0));
    const row = map.get(dateKey);
    if (!row) continue;
    const c = computeProdBonus(entry, wasteBonusPct);
    row.prodQty = round2(row.prodQty + (Number(entry.qtyProduced) || 0));
    row.prodBonus = round2(row.prodBonus + c.prodBonus);
  }

  return days.map((ms) => map.get(bangkokDateKey(ms))!);
}

export const OPS_SHIFT_SERIES: { id: OtShiftId; label: string; colorClass: string }[] = [
  { id: "morning", label: "โบนัสเช้า", colorClass: "pos-ops-line--morning" },
  { id: "evening", label: "โบนัสเย็น", colorClass: "pos-ops-line--evening" },
  { id: "late", label: "โบนัสดึก", colorClass: "pos-ops-line--late" },
];

/** Legend / series ids for the ops correlation chart (persisted prefs). */
export type PosOpsCorrSeriesId =
  | "sales"
  | "brewBonus"
  | OtShiftId
  | "brewQty"
  | "prodQty"
  | "prodBonus";

export const POS_OPS_CORR_SERIES_IDS: PosOpsCorrSeriesId[] = [
  "sales",
  "brewBonus",
  "morning",
  "evening",
  "late",
  "brewQty",
  "prodQty",
  "prodBonus",
];

export const POS_OPS_CORR_PREFS_KEY = "telltea_pos_ops_corr_prefs_v1";

export type PosOpsCorrPrefs = {
  version: 1;
  /** Which series lines are shown */
  visible: Record<PosOpsCorrSeriesId, boolean>;
  /**
   * Reserved for future manual axis overrides.
   * Today scale is always auto from visible series peaks.
   */
  scaleMode?: "auto";
};

export function defaultPosOpsCorrVisible(): Record<PosOpsCorrSeriesId, boolean> {
  return Object.fromEntries(POS_OPS_CORR_SERIES_IDS.map((id) => [id, true])) as Record<
    PosOpsCorrSeriesId,
    boolean
  >;
}

export function normalizePosOpsCorrVisible(
  raw: unknown,
): Record<PosOpsCorrSeriesId, boolean> {
  const base = defaultPosOpsCorrVisible();
  if (!raw || typeof raw !== "object") return base;
  const obj = raw as Record<string, unknown>;
  for (const id of POS_OPS_CORR_SERIES_IDS) {
    if (typeof obj[id] === "boolean") base[id] = obj[id];
  }
  // Never allow all-off — chart would be empty.
  if (!Object.values(base).some(Boolean)) return defaultPosOpsCorrVisible();
  return base;
}

export function loadPosOpsCorrPrefs(): PosOpsCorrPrefs {
  const visible = defaultPosOpsCorrVisible();
  if (typeof window === "undefined") {
    return { version: 1, visible, scaleMode: "auto" };
  }
  try {
    const raw = window.localStorage.getItem(POS_OPS_CORR_PREFS_KEY);
    if (!raw) return { version: 1, visible, scaleMode: "auto" };
    const parsed = JSON.parse(raw) as { visible?: unknown; scaleMode?: unknown };
    return {
      version: 1,
      visible: normalizePosOpsCorrVisible(parsed?.visible),
      scaleMode: "auto",
    };
  } catch {
    return { version: 1, visible, scaleMode: "auto" };
  }
}

export function savePosOpsCorrPrefs(prefs: {
  visible: Record<PosOpsCorrSeriesId, boolean>;
  scaleMode?: "auto";
}): void {
  if (typeof window === "undefined") return;
  try {
    const payload: PosOpsCorrPrefs = {
      version: 1,
      visible: normalizePosOpsCorrVisible(prefs.visible),
      scaleMode: "auto",
    };
    window.localStorage.setItem(POS_OPS_CORR_PREFS_KEY, JSON.stringify(payload));
  } catch {
    // ignore quota / private mode
  }
}

export { OT_SHIFT_DISPLAY_ORDER };
