/**
 * คัดแยกชนิดรายงาน + เดือนจากหัวข้อ+เนื้อ (ทุกแอพ)
 * ลำดับ: ช่วงวันที่ในเนื้อ → คำสรุปเดือนในเนื้อ → วันที่ในหัวข้อ → วันรับเมล
 *
 * เคสสำคัญ: Shopee subject "…2026-08-01" แต่เนื้อ
 * "รายงานยอดขายสะสมประจำเดือน / วันที่รายงาน: 2026-07-01 ถึง 2026-07-31"
 * → monthKey = 2026-07, reportKind = monthly
 */

const THAI_MONTHS = {
  มกราคม: 1,
  กุมภาพันธ์: 2,
  มีนาคม: 3,
  เมษายน: 4,
  พฤษภาคม: 5,
  มิถุนายน: 6,
  กรกฎาคม: 7,
  สิงหาคม: 8,
  กันยายน: 9,
  ตุลาคม: 10,
  พฤศจิกายน: 11,
  ธันวาคม: 12,
  "ม.ค": 1,
  "ก.พ": 2,
  "มี.ค": 3,
  "เม.ย": 4,
  "พ.ค": 5,
  "มิ.ย": 6,
  "ก.ค": 7,
  "ส.ค": 8,
  "ก.ย": 9,
  "ต.ค": 10,
  "พ.ย": 11,
  "ธ.ค": 12,
};

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toCeYear(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n >= 2400) return n - 543;
  if (n >= 1900) return n;
  if (n >= 0 && n < 100) return 2500 + n - 543;
  return null;
}

function okDate(y, mo, d) {
  return y >= 2018 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31;
}

function isoDate(y, mo, d) {
  if (!okDate(y, mo, d)) return "";
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

function bangkokDateKey(ms) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms || Date.now()));
}

function monthKeyOf(dateKey) {
  const s = String(dateKey || "").trim();
  return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : "";
}

function daysInMonth(y, mo) {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

function isFullMonthRange(start, end) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return false;
  }
  if (monthKeyOf(start) !== monthKeyOf(end)) return false;
  const y = Number(start.slice(0, 4));
  const mo = Number(start.slice(5, 7));
  return (
    start.slice(8, 10) === "01" &&
    Number(end.slice(8, 10)) === daysInMonth(y, mo)
  );
}

function haystack(subject, snippet, rawText) {
  return [
    String(subject || ""),
    String(snippet || ""),
    String(rawText || "").slice(0, 12000),
  ].join("\n");
}

function detectKind(hay) {
  const h = String(hay || "").toLowerCase();
  if (
    /ยอดขายสะสมประจำเดือน|สะสมประจำเดือน|สรุปเดือน|สรุปรอบเดือน|ประจำเดือน|ทั้งเดือน|month[- ]?end|monthly\s*(sales|summary|report)|end of month/.test(
      h,
    )
  ) {
    return "monthly";
  }
  if (
    /รายสัปดาห์|ประจำสัปดาห์|weekly|week[- ]?of|week\s*ending|สัปดาห์/.test(h)
  ) {
    return "weekly";
  }
  return "daily";
}

/** ดึงช่วงวันที่จากเนื้อ — คืน [start, end] ISO หรือ null */
function extractDateRange(hay) {
  const s = String(hay || "");

  const labeled = s.match(
    /วันที่รายงาน\s*[:：]?\s*(20\d{2}|25\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\s*(?:ถึง|ถึงวันที่|-|–|—|to)\s*(20\d{2}|25\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/i,
  );
  if (labeled) {
    const a = isoDate(toCeYear(labeled[1]), Number(labeled[2]), Number(labeled[3]));
    const b = isoDate(toCeYear(labeled[4]), Number(labeled[5]), Number(labeled[6]));
    if (a && b && a <= b) return [a, b];
  }

  const plain = s.match(
    /(?<!\d)(20\d{2}|25\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\s*(?:ถึง|ถึงวันที่|-|–|—|to)\s*(20\d{2}|25\d{2})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/i,
  );
  if (plain) {
    const a = isoDate(toCeYear(plain[1]), Number(plain[2]), Number(plain[3]));
    const b = isoDate(toCeYear(plain[4]), Number(plain[5]), Number(plain[6]));
    if (a && b && a <= b) return [a, b];
  }

  const dmy = s.match(
    /(?<!\d)(\d{1,2})[./](\d{1,2})[./](20\d{2}|25\d{2})\s*(?:ถึง|-|–|to)\s*(\d{1,2})[./](\d{1,2})[./](20\d{2}|25\d{2})(?!\d)/i,
  );
  if (dmy) {
    const a = isoDate(toCeYear(dmy[3]), Number(dmy[2]), Number(dmy[1]));
    const b = isoDate(toCeYear(dmy[6]), Number(dmy[5]), Number(dmy[4]));
    if (a && b && a <= b) return [a, b];
  }

  return null;
}

function extractThaiMonthPeriod(hay) {
  const thKeys = Object.keys(THAI_MONTHS).sort((a, b) => b.length - a.length);
  const esc = (k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `(?:ประจำเดือน|สรุปเดือน|เดือน)\\s*(${thKeys.map(esc).join("|")})\\.?\\s*(25\\d{2}|20\\d{2}|\\d{2})`,
    "i",
  );
  const m = String(hay || "").match(re);
  if (!m) return null;
  const mo = THAI_MONTHS[m[1].replace(/\.$/, "")] || THAI_MONTHS[m[1]];
  const y = toCeYear(m[2]);
  if (!mo || !y) return null;
  const start = isoDate(y, mo, 1);
  const end = isoDate(y, mo, daysInMonth(y, mo));
  return start && end ? [start, end] : null;
}

function extractSingleDate(text) {
  const s = String(text || "");
  const thKeys = Object.keys(THAI_MONTHS).sort((a, b) => b.length - a.length);
  const esc = (k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const thRe = new RegExp(
    `(\\d{1,2})\\s*(${thKeys.map(esc).join("|")})\\.?\\s*(25\\d{2}|20\\d{2}|\\d{2})`,
    "i",
  );
  const th = s.match(thRe);
  if (th) {
    const d = isoDate(
      toCeYear(th[3]),
      THAI_MONTHS[th[2].replace(/\.$/, "")] || THAI_MONTHS[th[2]],
      Number(th[1]),
    );
    if (d) return d;
  }
  const iso = s.match(/(?<!\d)(20\d{2}|25\d{2})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/);
  if (iso) {
    const d = isoDate(toCeYear(iso[1]), Number(iso[2]), Number(iso[3]));
    if (d) return d;
  }
  const dmy4 = s.match(/(?<!\d)(\d{1,2})[./](\d{1,2})[./](20\d{2}|25\d{2})(?!\d)/);
  if (dmy4) {
    const d = isoDate(toCeYear(dmy4[3]), Number(dmy4[2]), Number(dmy4[1]));
    if (d) return d;
  }
  const dmy2 = s.match(/(?<!\d)(\d{1,2})[./](\d{1,2})[./](\d{2})(?!\d)/);
  if (dmy2) {
    const d = isoDate(toCeYear(dmy2[3]), Number(dmy2[2]), Number(dmy2[1]));
    if (d) return d;
  }
  return "";
}

/**
 * @returns {{
 *   reportKind: 'daily'|'weekly'|'monthly',
 *   reportDateGuess: string,
 *   periodStart: string,
 *   periodEnd: string,
 *   monthKey: string,
 *   confidence: number,
 *   source: string,
 * }}
 */
function resolveReportPeriod(input) {
  const subject = String(input?.subject || "");
  const snippet = String(input?.snippet || "");
  const rawText = String(input?.rawText || "");
  const receivedAt = Number(input?.receivedAt) || Date.now();
  const hay = haystack(subject, snippet, rawText);
  const bodyHay = `${snippet}\n${rawText.slice(0, 12000)}`;

  let kind = detectKind(hay);
  const range =
    extractDateRange(bodyHay) ||
    extractDateRange(hay) ||
    extractThaiMonthPeriod(bodyHay) ||
    extractThaiMonthPeriod(hay);

  if (range) {
    const [periodStart, periodEnd] = range;
    if (isFullMonthRange(periodStart, periodEnd) || kind === "monthly") {
      kind = "monthly";
    } else if (
      kind === "daily" &&
      monthKeyOf(periodStart) === monthKeyOf(periodEnd) &&
      periodStart !== periodEnd
    ) {
      // ช่วงหลายวันในเดือนเดียวแต่ไม่เต็มเดือน — ถ้าไม่มีคำ monthly เก็บ daily/weekly ตาม detect
      const span =
        (Date.parse(`${periodEnd}T12:00:00+07:00`) -
          Date.parse(`${periodStart}T12:00:00+07:00`)) /
        86400000;
      if (span >= 6 && span <= 8) kind = "weekly";
      else if (span >= 27) kind = "monthly";
    }
    return {
      reportKind: kind,
      reportDateGuess: periodEnd,
      periodStart,
      periodEnd,
      monthKey: monthKeyOf(periodEnd),
      confidence: kind === "monthly" || isFullMonthRange(periodStart, periodEnd) ? 0.96 : 0.9,
      source: "body-range",
    };
  }

  // สรุปเดือนในเนื้อ แต่ไม่มีช่วง — อย่าเชื่อวันที่ในหัวข้อถ้าเป็นวันที่ 1 เดือนถัดไป
  if (kind === "monthly") {
    const subjectDate = extractSingleDate(subject);
    const bodyDate = extractSingleDate(bodyHay);
    const receivedKey = bangkokDateKey(receivedAt);
    let reportDateGuess = bodyDate || subjectDate || receivedKey;
    let monthKey = monthKeyOf(reportDateGuess);
    // หัวข้อวันที่ 1 ของเดือน + ส่งต้นเดือน → มักเป็นสรุปเดือนก่อน
    if (
      subjectDate &&
      subjectDate.slice(8, 10) === "01" &&
      (!bodyDate || bodyDate === subjectDate)
    ) {
      const y = Number(subjectDate.slice(0, 4));
      const mo = Number(subjectDate.slice(5, 7));
      const prevMo = mo === 1 ? 12 : mo - 1;
      const prevY = mo === 1 ? y - 1 : y;
      const end = isoDate(prevY, prevMo, daysInMonth(prevY, prevMo));
      const start = isoDate(prevY, prevMo, 1);
      return {
        reportKind: "monthly",
        reportDateGuess: end,
        periodStart: start,
        periodEnd: end,
        monthKey: monthKeyOf(end),
        confidence: 0.72,
        source: "monthly-subject-rollbacks",
      };
    }
    const start = monthKey ? `${monthKey}-01` : "";
    const end = reportDateGuess;
    return {
      reportKind: "monthly",
      reportDateGuess,
      periodStart: start,
      periodEnd: end,
      monthKey,
      confidence: bodyDate ? 0.8 : 0.65,
      source: bodyDate ? "body-date-monthly" : "subject-monthly",
    };
  }

  const subjectDate = extractSingleDate(subject);
  if (subjectDate) {
    return {
      reportKind: kind,
      reportDateGuess: subjectDate,
      periodStart: subjectDate,
      periodEnd: subjectDate,
      monthKey: monthKeyOf(subjectDate),
      confidence: 0.75,
      source: "subject-date",
    };
  }

  const bodyDate = extractSingleDate(bodyHay);
  if (bodyDate) {
    return {
      reportKind: kind,
      reportDateGuess: bodyDate,
      periodStart: bodyDate,
      periodEnd: bodyDate,
      monthKey: monthKeyOf(bodyDate),
      confidence: 0.7,
      source: "body-date",
    };
  }

  const receivedKey = bangkokDateKey(receivedAt);
  return {
    reportKind: kind,
    reportDateGuess: receivedKey,
    periodStart: receivedKey,
    periodEnd: receivedKey,
    monthKey: monthKeyOf(receivedKey),
    confidence: 0.4,
    source: "received",
  };
}

function periodFieldsFromResolved(resolved) {
  const r = resolved || {};
  return {
    reportDateGuess: String(r.reportDateGuess || "").slice(0, 10),
    reportKind:
      r.reportKind === "weekly" || r.reportKind === "monthly"
        ? r.reportKind
        : "daily",
    periodStart: String(r.periodStart || "").slice(0, 10),
    periodEnd: String(r.periodEnd || "").slice(0, 10),
    periodMonthKey: String(r.monthKey || "").slice(0, 7),
    periodSource: String(r.source || "").slice(0, 40),
    periodConfidence: Number(r.confidence) || 0,
  };
}

module.exports = {
  resolveReportPeriod,
  periodFieldsFromResolved,
  detectKind,
  extractDateRange,
  isFullMonthRange,
  monthKeyOf,
};
