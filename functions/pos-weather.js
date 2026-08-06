/**
 * POS dashboard weather for Udon Thani station (TMD) + archive backfill.
 *
 * - Past complete days: write once as status=final, never refresh.
 * - Today / incomplete: refresh from TMD Open Data.
 * - History: TMD WeatherToday ignores date= → one-time Open-Meteo archive
 *   at the TMD Udon station coordinates (labeled source).
 */
const functions = require("firebase-functions/v1");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const REGION = "asia-southeast1";
const COL = "weatherDays";
const OWNER_EMAIL = String(process.env.TELLTEA_OWNER_EMAIL || "yohaken@gmail.com")
  .trim()
  .toLowerCase();

const UDON = {
  nameTh: "อุดรธานี",
  wmo: "48354",
  lat: 17.38333,
  lon: 102.8,
};

const TMD_UID = process.env.TMD_API_UID || "demo";
const TMD_UKEY = process.env.TMD_API_UKEY || "demokey";

function bangkokParts(ms = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const get = (t) => parts.find((p) => p.type === t)?.value || "0";
  return {
    y: Number(get("year")),
    m: Number(get("month")),
    d: Number(get("day")),
    hour: Number(get("hour")),
  };
}

function bangkokDateKey(ms = Date.now()) {
  const p = bangkokParts(ms);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

function addDaysKey(dateKey, delta) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d) + delta * 86400000;
  return bangkokDateKey(utc - 7 * 3600000);
}

async function assertOwner(context) {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
  }
  const email = String(context.auth.token.email || "").trim().toLowerCase();
  let ok = email && email === OWNER_EMAIL;
  if (!ok && email) {
    const staff = await getFirestore().collection("staff").doc(context.auth.uid).get();
    ok = staff.exists && staff.get("role") === "owner";
  }
  if (!ok) {
    throw new functions.https.HttpsError("permission-denied", "เจ้าของเท่านั้น");
  }
}

function conditionFromRainAndCode(rainfallMm, wmoCode) {
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

function shortLine(emoji, labelTh, tempMin, tempMax) {
  const lo = Number.isFinite(tempMin) ? Math.round(tempMin) : null;
  const hi = Number.isFinite(tempMax) ? Math.round(tempMax) : null;
  const temp =
    lo != null && hi != null ? `${lo}–${hi}°` : hi != null ? `${hi}°` : lo != null ? `${lo}°` : "";
  return [emoji, labelTh, temp].filter(Boolean).join(" · ");
}

function periodBucket(hour) {
  if (hour >= 10 && hour <= 16) return "day";
  if (hour >= 19 && hour <= 22) return "evening";
  if (hour >= 1 && hour <= 7) return "night";
  return null;
}

function summarizePeriod(rows) {
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
  const tempAvg = n ? Math.round((tSum / n) * 10) / 10 : null;
  return {
    labelTh: cond.labelTh,
    emoji: cond.emoji,
    condition: cond.condition,
    tempAvg,
    rainfallMm: Math.round(rain * 10) / 10,
  };
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "TellTea-pos-weather/1" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

function findUdonStation(payload) {
  const stations = payload?.Stations?.Station || payload?.Station || [];
  const list = Array.isArray(stations) ? stations : stations ? [stations] : [];
  return (
    list.find(
      (s) =>
        String(s.StationNameThai || "").includes("อุดร") ||
        String(s.WmoStationNumber || "") === UDON.wmo,
    ) || null
  );
}

async function fetchTmdToday() {
  const url = `https://data.tmd.go.th/api/WeatherToday/V2/?uid=${encodeURIComponent(
    TMD_UID,
  )}&ukey=${encodeURIComponent(TMD_UKEY)}&format=json`;
  const data = await fetchJson(url);
  const station = findUdonStation(data);
  if (!station) throw new Error("ไม่พบสถานีอุดรธานีใน TMD WeatherToday");
  const obs = station.Observation || {};
  const tempMin = Number(obs.MinTemperature);
  const tempMax = Number(obs.MaxTemperature);
  const rainfallMm = Number(obs.Rainfall);
  const cond = conditionFromRainAndCode(rainfallMm, null);
  return {
    source: "tmd",
    stationName: String(station.StationNameThai || UDON.nameTh),
    stationWmo: String(station.WmoStationNumber || UDON.wmo),
    obsDateTime: String(obs.DateTime || ""),
    tempMin: Number.isFinite(tempMin) ? tempMin : null,
    tempMax: Number.isFinite(tempMax) ? tempMax : null,
    rainfallMm: Number.isFinite(rainfallMm) ? rainfallMm : 0,
    ...cond,
  };
}

function daysBetween(a, b) {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const aUtc = Date.UTC(ay, am - 1, ad);
  const bUtc = Date.UTC(by, bm - 1, bd);
  return Math.round((bUtc - aUtc) / 86400000);
}

/** Recent days: forecast+past_days (fresh). Older: ERA5 archive. */
async function fetchHistoryRange(startKey, endKey, todayKey) {
  const ageStart = daysBetween(startKey, todayKey);
  if (ageStart <= 90) {
    const pastDays = Math.min(92, Math.max(1, ageStart + 1));
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${UDON.lat}&longitude=${UDON.lon}` +
      `&past_days=${pastDays}&forecast_days=1` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum` +
      `&hourly=weather_code,temperature_2m,precipitation` +
      `&timezone=Asia%2FBangkok`;
    return fetchJson(url);
  }
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${UDON.lat}&longitude=${UDON.lon}` +
    `&start_date=${startKey}&end_date=${endKey}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum` +
    `&hourly=weather_code,temperature_2m,precipitation` +
    `&timezone=Asia%2FBangkok`;
  return fetchJson(url);
}

function buildFromArchiveDay(archive, dateKey) {
  const daily = archive.daily || {};
  const idx = (daily.time || []).indexOf(dateKey);
  if (idx < 0) return null;
  const code = daily.weather_code?.[idx];
  const tempMax = Number(daily.temperature_2m_max?.[idx]);
  const tempMin = Number(daily.temperature_2m_min?.[idx]);
  const rainfallMm = Number(daily.precipitation_sum?.[idx]);
  const cond = conditionFromRainAndCode(rainfallMm, code);

  const buckets = { day: [], evening: [], night: [] };
  const times = archive.hourly?.time || [];
  for (let i = 0; i < times.length; i++) {
    const t = String(times[i] || "");
    if (!t.startsWith(dateKey)) continue;
    const hour = Number(t.slice(11, 13));
    const bucket = periodBucket(hour);
    if (!bucket) continue;
    buckets[bucket].push({
      hour,
      temp: Number(archive.hourly.temperature_2m?.[i]),
      rain: Number(archive.hourly.precipitation?.[i]),
      code: Number(archive.hourly.weather_code?.[i]),
    });
  }

  const periods = {
    day: summarizePeriod(buckets.day),
    evening: summarizePeriod(buckets.evening),
    night: summarizePeriod(buckets.night),
  };

  return {
    source: "open-meteo-history",
    stationName: UDON.nameTh,
    stationWmo: UDON.wmo,
    tempMin: Number.isFinite(tempMin) ? tempMin : null,
    tempMax: Number.isFinite(tempMax) ? tempMax : null,
    rainfallMm: Number.isFinite(rainfallMm) ? rainfallMm : 0,
    periods,
    ...cond,
  };
}

function toDoc(dateKey, built, status) {
  const short = shortLine(built.emoji, built.labelTh, built.tempMin, built.tempMax);
  return {
    dateKey,
    status,
    source: built.source,
    stationName: built.stationName,
    stationWmo: built.stationWmo,
    condition: built.condition,
    labelTh: built.labelTh,
    emoji: built.emoji,
    tempMin: built.tempMin,
    tempMax: built.tempMax,
    rainfallMm: built.rainfallMm,
    periods: built.periods || null,
    shortLine: short,
    obsDateTime: built.obsDateTime || null,
    fetchedAt: Date.now(),
    updatedAt: Date.now(),
    ...(status === "final" ? { finalizedAt: Date.now() } : { finalizedAt: null }),
  };
}

async function ensureOne(db, dateKey, todayKey, archiveCache) {
  const ref = db.collection(COL).doc(dateKey);
  const snap = await ref.get();
  if (snap.exists && snap.get("status") === "final") {
    return { dateKey, doc: snap.data(), skipped: true };
  }

  const isToday = dateKey === todayKey;
  const isPast = dateKey < todayKey;

  if (isPast) {
    if (!archiveCache.payload) {
      archiveCache.payload = await fetchHistoryRange(
        archiveCache.startKey,
        archiveCache.endKey,
        todayKey,
      );
    }
    const built = buildFromArchiveDay(archiveCache.payload, dateKey);
    if (!built) {
      return { dateKey, doc: snap.exists ? snap.data() : null, skipped: true, missing: true };
    }
    const doc = toDoc(dateKey, built, "final");
    await ref.set(doc, { merge: true });
    return { dateKey, doc, skipped: false };
  }

  if (isToday) {
    let built;
    try {
      const tmd = await fetchTmdToday();
      // Periods from same-day history model (aligned to shop hours).
      if (!archiveCache.payload) {
        archiveCache.payload = await fetchHistoryRange(todayKey, todayKey, todayKey);
      }
      const hist = buildFromArchiveDay(archiveCache.payload, todayKey);
      built = { ...tmd, periods: hist?.periods || null };
    } catch (err) {
      if (!archiveCache.payload) {
        archiveCache.payload = await fetchHistoryRange(todayKey, todayKey, todayKey);
      }
      built = buildFromArchiveDay(archiveCache.payload, todayKey);
      if (!built) throw err;
    }
    const doc = toDoc(dateKey, built, "open");
    await ref.set(
      {
        ...doc,
        finalizedAt: FieldValue.delete(),
      },
      { merge: true },
    );
    return { dateKey, doc, skipped: false };
  }

  // Future keys — ignore
  return { dateKey, doc: null, skipped: true };
}

exports.ensurePosWeatherDays = functions
  .region(REGION)
  .runWith({ timeoutSeconds: 120, memory: "256MB" })
  .https.onCall(async (data, context) => {
    await assertOwner(context);
    const rawKeys = Array.isArray(data?.dateKeys) ? data.dateKeys : [];
    const keys = [
      ...new Set(
        rawKeys
          .map((k) => String(k || "").trim())
          .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)),
      ),
    ].slice(0, 93);
    if (!keys.length) return { ok: true, days: {} };

    const todayKey = bangkokDateKey();
    const pastKeys = keys.filter((k) => k < todayKey).sort();
    const archiveCache = {
      startKey: pastKeys[0] || todayKey,
      endKey: pastKeys.length ? pastKeys[pastKeys.length - 1] : todayKey,
      payload: null,
    };
    // Include today in archive fallback window when needed
    if (keys.includes(todayKey)) {
      archiveCache.endKey =
        archiveCache.endKey < todayKey ? todayKey : archiveCache.endKey;
      if (archiveCache.startKey > todayKey) archiveCache.startKey = todayKey;
    }

    const db = getFirestore();
    const days = {};
    for (const key of keys) {
      try {
        const row = await ensureOne(db, key, todayKey, archiveCache);
        if (row.doc) days[key] = row.doc;
      } catch (err) {
        console.error("ensurePosWeatherDays", key, err);
        days[key] = {
          dateKey: key,
          status: "open",
          error: err instanceof Error ? err.message : String(err),
          shortLine: "—",
          emoji: "",
          labelTh: "",
        };
      }
    }
    return { ok: true, todayKey, days };
  });

/** Seal yesterday as final after morning TMD cycle (08:10 Bangkok). */
exports.posWeatherFinalizeDaily = functions
  .region(REGION)
  .runWith({ timeoutSeconds: 60, memory: "256MB" })
  .pubsub.schedule("10 8 * * *")
  .timeZone("Asia/Bangkok")
  .onRun(async () => {
    const db = getFirestore();
    const todayKey = bangkokDateKey();
    const yKey = addDaysKey(todayKey, -1);
    const ref = db.collection(COL).doc(yKey);
    const snap = await ref.get();
    if (snap.exists && snap.get("status") === "final") {
      console.log("posWeatherFinalizeDaily already final", yKey);
      return null;
    }
    const archive = await fetchHistoryRange(yKey, yKey, todayKey);
    const built = buildFromArchiveDay(archive, yKey);
    if (!built) {
      console.warn("posWeatherFinalizeDaily missing archive", yKey);
      return null;
    }
    // Prefer locking archive calendar day (aligned to sales dateKey).
    await ref.set(toDoc(yKey, built, "final"), { merge: true });
    console.log("posWeatherFinalizeDaily finalized", yKey);
    return null;
  });
