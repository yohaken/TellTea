/**
 * Daily weather for POS sales dashboard (Udon Thani).
 * Past days: prefer Firestore cache (final). Today: refresh via CF when allowed.
 * If CF fails (e.g. localhost anonymous owner bypass → 403), fall back to
 * Open-Meteo in the browser so the table still shows real weather.
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

const UDON = { lat: 17.38333, lon: 102.8, nameTh: "อุดรธานี", wmo: "48354" };

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

function conditionFromRainAndCode(rainfallMm: number, wmoCode: number | null) {
  const rain = Number(rainfallMm) || 0;
  const code = Number.isFinite(Number(wmoCode)) ? Number(wmoCode) : null;
  if (code != null) {
    if (code === 0) return { condition: "clear", labelTh: "แดดออก", emoji: "☀️" };
    if (code <= 3) return { condition: "partly", labelTh: "มีเมฆ", emoji: "⛅" };
    if (code <= 48) return { condition: "fog", labelTh: "หมอก", emoji: "🌫" };
    if (code <= 57) return { condition: "drizzle", labelTh: "ฝนปรอย", emoji: "🌦" };
    if (code <= 67) return { condition: "rain", labelTh: "ฝนตก", emoji: "🌧" };
    if (code <= 77) return { condition: "snow", labelTh: "หิมะ/เม็ดน้ำแข็ง", emoji: "❄️" };
    if (code <= 82) return { condition: "rain", labelTh: "ฝนตกหนัก", emoji: "🌧" };
    if (code <= 99) return { condition: "storm", labelTh: "ฝนฟ้าคะนอง", emoji: "⛈" };
  }
  if (rain >= 20) return { condition: "rain", labelTh: "ฝนตกหนัก", emoji: "🌧" };
  if (rain >= 1) return { condition: "rain", labelTh: "ฝนตก", emoji: "🌧" };
  if (rain > 0) return { condition: "drizzle", labelTh: "ฝนปรอย", emoji: "🌦" };
  return { condition: "partly", labelTh: "มีเมฆถึงฟ้าโปร่ง", emoji: "⛅" };
}

function shortLine(
  emoji: string,
  labelTh: string,
  tempMin: number | null | undefined,
  tempMax: number | null | undefined,
) {
  const lo = Number.isFinite(Number(tempMin)) ? Math.round(Number(tempMin)) : null;
  const hi = Number.isFinite(Number(tempMax)) ? Math.round(Number(tempMax)) : null;
  const temp =
    lo != null && hi != null ? `${lo}–${hi}°` : hi != null ? `${hi}°` : lo != null ? `${lo}°` : "";
  return [emoji, labelTh, temp].filter(Boolean).join(" · ");
}

function periodBucket(hour: number): "day" | "evening" | "night" | null {
  if (hour >= 10 && hour <= 16) return "day";
  if (hour >= 19 && hour <= 22) return "evening";
  if (hour >= 1 && hour <= 7) return "night";
  return null;
}

function summarizePeriod(
  rows: Array<{ rain: number; temp: number; code: number }>,
): WeatherPeriodSlice | null {
  if (!rows.length) return null;
  let rain = 0;
  let tSum = 0;
  let n = 0;
  let worstCode = 0;
  for (const r of rows) {
    rain += Number(r.rain) || 0;
    if (Number.isFinite(r.temp)) {
      tSum += r.temp;
      n += 1;
    }
    if ((Number(r.code) || 0) > worstCode) worstCode = Number(r.code) || 0;
  }
  const cond = conditionFromRainAndCode(rain, worstCode || null);
  return {
    labelTh: cond.labelTh,
    emoji: cond.emoji,
    condition: cond.condition,
    tempAvg: n ? Math.round((tSum / n) * 10) / 10 : null,
    rainfallMm: Math.round(rain * 10) / 10,
  };
}

function mapDoc(id: string, data: DocumentData | undefined): WeatherDayDoc | null {
  if (!data) return null;
  const labelTh = typeof data.labelTh === "string" ? data.labelTh : "";
  const emoji = typeof data.emoji === "string" ? data.emoji : "";
  const short =
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
    shortLine: short,
    fetchedAt: Number(data.fetchedAt) || undefined,
    finalizedAt: data.finalizedAt == null ? null : Number(data.finalizedAt) || null,
    error: typeof data.error === "string" ? data.error : undefined,
  };
}

function hasUsableWeather(row: WeatherDayDoc | undefined): boolean {
  if (!row || row.error) return false;
  return Boolean(row.labelTh || (row.shortLine && row.shortLine !== "—"));
}

/** Read cached weather docs (chunks of 30 for `in` queries). */
export async function loadWeatherDays(
  dateKeys: string[],
): Promise<Record<string, WeatherDayDoc>> {
  const keys = [...new Set(dateKeys.filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)))];
  const out: Record<string, WeatherDayDoc> = {};
  if (!keys.length) return out;
  try {
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
  } catch {
    // Permission / offline — caller may still fill via Open-Meteo.
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
    if (k < today) return !hasUsableWeather(row);
    if (!hasUsableWeather(row)) return true;
    const fetchedAt = Number(row.fetchedAt) || 0;
    return now - fetchedAt >= WEATHER_TODAY_REFRESH_MS;
  });
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

function buildFromArchiveDay(
  archive: {
    daily?: {
      time?: string[];
      weather_code?: number[];
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
      precipitation_sum?: number[];
    };
    hourly?: {
      time?: string[];
      weather_code?: number[];
      temperature_2m?: number[];
      precipitation?: number[];
    };
  },
  dateKey: string,
  today: string,
): WeatherDayDoc | null {
  const daily = archive.daily || {};
  const idx = (daily.time || []).indexOf(dateKey);
  if (idx < 0) return null;
  const code = daily.weather_code?.[idx];
  const tempMax = Number(daily.temperature_2m_max?.[idx]);
  const tempMin = Number(daily.temperature_2m_min?.[idx]);
  const rainfallMm = Number(daily.precipitation_sum?.[idx]);
  const cond = conditionFromRainAndCode(
    Number.isFinite(rainfallMm) ? rainfallMm : 0,
    code == null ? null : Number(code),
  );

  const buckets: Record<"day" | "evening" | "night", Array<{ rain: number; temp: number; code: number }>> = {
    day: [],
    evening: [],
    night: [],
  };
  const times = archive.hourly?.time || [];
  for (let i = 0; i < times.length; i++) {
    const t = String(times[i] || "");
    if (!t.startsWith(dateKey)) continue;
    const hour = Number(t.slice(11, 13));
    const bucket = periodBucket(hour);
    if (!bucket) continue;
    buckets[bucket].push({
      temp: Number(archive.hourly?.temperature_2m?.[i]),
      rain: Number(archive.hourly?.precipitation?.[i]),
      code: Number(archive.hourly?.weather_code?.[i]),
    });
  }

  const periods = {
    day: summarizePeriod(buckets.day),
    evening: summarizePeriod(buckets.evening),
    night: summarizePeriod(buckets.night),
  };
  const lo = Number.isFinite(tempMin) ? tempMin : null;
  const hi = Number.isFinite(tempMax) ? tempMax : null;
  return {
    dateKey,
    status: dateKey < today ? "final" : "open",
    source: "open-meteo-client",
    stationName: UDON.nameTh,
    stationWmo: UDON.wmo,
    condition: cond.condition,
    labelTh: cond.labelTh,
    emoji: cond.emoji,
    tempMin: lo,
    tempMax: hi,
    rainfallMm: Number.isFinite(rainfallMm) ? rainfallMm : 0,
    periods,
    shortLine: shortLine(cond.emoji, cond.labelTh, lo, hi),
    fetchedAt: Date.now(),
    finalizedAt: dateKey < today ? Date.now() : null,
  };
}

/** Browser fallback when Cloud Function is unavailable (local owner bypass, etc.). */
export async function fetchOpenMeteoWeatherDays(
  dateKeys: string[],
): Promise<Record<string, WeatherDayDoc>> {
  const today = bangkokTodayKey();
  const keys = [...new Set(dateKeys.filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k) && k <= today))].sort();
  const out: Record<string, WeatherDayDoc> = {};
  if (!keys.length) return out;

  const startKey = keys[0]!;
  const endKey = keys[keys.length - 1]!;
  const ageStart = daysBetween(startKey, today);
  const url =
    ageStart <= 90
      ? `https://api.open-meteo.com/v1/forecast?latitude=${UDON.lat}&longitude=${UDON.lon}` +
        `&past_days=${Math.min(92, Math.max(1, ageStart + 1))}&forecast_days=1` +
        `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum` +
        `&hourly=weather_code,temperature_2m,precipitation` +
        `&timezone=Asia%2FBangkok`
      : `https://archive-api.open-meteo.com/v1/archive?latitude=${UDON.lat}&longitude=${UDON.lon}` +
        `&start_date=${startKey}&end_date=${endKey}` +
        `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum` +
        `&hourly=weather_code,temperature_2m,precipitation` +
        `&timezone=Asia%2FBangkok`;

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const archive = (await res.json()) as Parameters<typeof buildFromArchiveDay>[0];
  for (const key of keys) {
    const row = buildFromArchiveDay(archive, key, today);
    if (row) out[key] = row;
  }
  return out;
}

/**
 * Ensure weather for date keys.
 * - Prefer Cloud Function (TMD today + locked past in Firestore).
 * - On CF failure / still missing: Open-Meteo browser fallback (display only).
 */
export async function ensurePosWeatherDays(
  dateKeys: string[],
): Promise<Record<string, WeatherDayDoc>> {
  const keys = [...new Set(dateKeys.filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)))];
  if (!keys.length) return {};

  const cached = await loadWeatherDays(keys);
  const today = bangkokTodayKey();
  let need = keysNeedingFetch(keys, cached, today);

  if (need.length) {
    try {
      const fn = httpsCallable<
        { dateKeys: string[] },
        { ok: boolean; days?: Record<string, DocumentData> }
      >(getFirebaseFunctions(), "ensurePosWeatherDays");
      const res = await fn({ dateKeys: need });
      const days = res.data?.days || {};
      for (const [k, raw] of Object.entries(days)) {
        const row = mapDoc(k, raw);
        if (row && hasUsableWeather(row)) cached[k] = row;
      }
    } catch {
      // Keep Firestore cache — do not wipe the table when CF returns 403.
    }
  }

  need = keysNeedingFetch(keys, cached, today);
  if (need.length) {
    try {
      const fallback = await fetchOpenMeteoWeatherDays(need);
      for (const [k, row] of Object.entries(fallback)) {
        if (hasUsableWeather(row)) cached[k] = row;
      }
    } catch {
      // Leave gaps as empty — UI shows "—".
    }
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
  else if (day.source === "open-meteo-history" || day.source === "open-meteo-client")
    parts.push("แหล่ง: ข้อมูลอุตุฯพิกัดสถานีอุดรฯ");
  return parts.filter(Boolean).join(" · ");
}

/** Exported for unit tests. */
export const __posWeatherTest = {
  keysNeedingFetch,
  hasUsableWeather,
  bangkokTodayKey,
  conditionFromRainAndCode,
  buildFromArchiveDay,
};
