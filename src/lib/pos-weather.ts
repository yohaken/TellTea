/**
 * Daily weather for POS sales dashboard (Udon Thani).
 * Past days: read Firestore only (final). Today: refresh at most every 45 min.
 */
import {
  collection,
  documentId,
  getDocs,
  query,
  where,
  type DocumentData,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { getDb, getFirebaseFunctions } from "./firebase";

export const WEATHER_DAYS_COL = "weatherDays";

/** Don't re-hit TMD/history for "today" more often than this. */
export const WEATHER_TODAY_REFRESH_MS = 45 * 60 * 1000;

export type WeatherPeriodSlice = {
  labelTh: string;
  emoji: string;
  condition?: string;
  tempAvg?: number | null;
  rainfallMm?: number | null;
};

export type WeatherDayDoc = {
  dateKey: string;
  status: "open" | "final";
  source?: string;
  stationName?: string;
  stationWmo?: string;
  condition?: string;
  labelTh: string;
  emoji: string;
  tempMin?: number | null;
  tempMax?: number | null;
  rainfallMm?: number | null;
  periods?: {
    day?: WeatherPeriodSlice | null;
    evening?: WeatherPeriodSlice | null;
    night?: WeatherPeriodSlice | null;
  } | null;
  shortLine: string;
  fetchedAt?: number;
  finalizedAt?: number | null;
  error?: string;
};

function bangkokTodayKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function mapDoc(id: string, data: DocumentData | undefined): WeatherDayDoc | null {
  if (!data) return null;
  const labelTh = typeof data.labelTh === "string" ? data.labelTh : "";
  const emoji = typeof data.emoji === "string" ? data.emoji : "";
  const shortLine =
    typeof data.shortLine === "string" && data.shortLine.trim()
      ? data.shortLine.trim()
      : [emoji, labelTh].filter(Boolean).join(" · ") || "—";
  return {
    dateKey: typeof data.dateKey === "string" ? data.dateKey : id,
    status: data.status === "final" ? "final" : "open",
    source: typeof data.source === "string" ? data.source : undefined,
    stationName: typeof data.stationName === "string" ? data.stationName : undefined,
    stationWmo: typeof data.stationWmo === "string" ? data.stationWmo : undefined,
    condition: typeof data.condition === "string" ? data.condition : undefined,
    labelTh,
    emoji,
    tempMin: Number.isFinite(Number(data.tempMin)) ? Number(data.tempMin) : null,
    tempMax: Number.isFinite(Number(data.tempMax)) ? Number(data.tempMax) : null,
    rainfallMm: Number.isFinite(Number(data.rainfallMm)) ? Number(data.rainfallMm) : null,
    periods: (data.periods as WeatherDayDoc["periods"]) || null,
    shortLine,
    fetchedAt: Number(data.fetchedAt) || undefined,
    finalizedAt: data.finalizedAt == null ? null : Number(data.finalizedAt) || null,
    error: typeof data.error === "string" ? data.error : undefined,
  };
}

function hasUsableWeather(row: WeatherDayDoc | undefined): boolean {
  if (!row || row.error) return false;
  return Boolean(row.labelTh || row.shortLine && row.shortLine !== "—");
}

/** Read cached weather docs (chunks of 30 for `in` queries). */
export async function loadWeatherDays(
  dateKeys: string[],
): Promise<Record<string, WeatherDayDoc>> {
  const keys = [...new Set(dateKeys.filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)))];
  const out: Record<string, WeatherDayDoc> = {};
  if (!keys.length) return out;
  const db = getDb();
  for (let i = 0; i < keys.length; i += 30) {
    const chunk = keys.slice(i, i + 30);
    const snap = await getDocs(
      query(collection(db, WEATHER_DAYS_COL), where(documentId(), "in", chunk)),
    );
    for (const d of snap.docs) {
      const row = mapDoc(d.id, d.data());
      if (row) out[d.id] = row;
    }
  }
  return out;
}

function keysNeedingFetch(
  keys: string[],
  cached: Record<string, WeatherDayDoc>,
  today: string,
  now = Date.now(),
): string[] {
  return keys.filter((k) => {
    const row = cached[k];
    if (k > today) return false;
    if (k < today) {
      // Past: only fetch if never saved. Saved past days stay locked.
      return !hasUsableWeather(row);
    }
    // Today: refresh only when missing or stale.
    if (!hasUsableWeather(row)) return true;
    const fetchedAt = Number(row.fetchedAt) || 0;
    return now - fetchedAt >= WEATHER_TODAY_REFRESH_MS;
  });
}

/**
 * Ensure weather for date keys.
 * - Past: Firestore cache only after first save (final).
 * - Today: refresh at most every WEATHER_TODAY_REFRESH_MS.
 */
export async function ensurePosWeatherDays(
  dateKeys: string[],
): Promise<Record<string, WeatherDayDoc>> {
  const keys = [...new Set(dateKeys.filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)))];
  if (!keys.length) return {};

  const cached = await loadWeatherDays(keys);
  const today = bangkokTodayKey();
  const need = keysNeedingFetch(keys, cached, today);

  if (!need.length) return cached;

  const fn = httpsCallable<
    { dateKeys: string[] },
    { ok: boolean; days?: Record<string, DocumentData> }
  >(getFirebaseFunctions(), "ensurePosWeatherDays");
  const res = await fn({ dateKeys: need });
  const days = res.data?.days || {};
  for (const [k, raw] of Object.entries(days)) {
    const row = mapDoc(k, raw);
    if (row) cached[k] = row;
  }
  return cached;
}

export function weatherCellTitle(day: WeatherDayDoc | undefined): string {
  if (!day) return "";
  const parts = [day.shortLine];
  const p = day.periods;
  if (p?.day?.labelTh) parts.push(`กลางวัน ${p.day.emoji}${p.day.labelTh}`);
  if (p?.evening?.labelTh) parts.push(`เย็น ${p.evening.emoji}${p.evening.labelTh}`);
  if (p?.night?.labelTh) parts.push(`ดึก ${p.night.emoji}${p.night.labelTh}`);
  if (day.source === "tmd") parts.push("แหล่ง: กรมอุตุฯ สถานีอุดรธานี");
  else if (day.source === "open-meteo-history")
    parts.push("แหล่ง: ข้อมูลอุตุฯพิกัดสถานีอุดรฯ (ย้อนหลัง)");
  return parts.filter(Boolean).join(" · ");
}

/** Exported for unit tests. */
export const __posWeatherTest = {
  keysNeedingFetch,
  hasUsableWeather,
  bangkokTodayKey,
};
