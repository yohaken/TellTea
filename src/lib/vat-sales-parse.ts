/**
 * Parse platform daily sales emails → amounts for dailySales.
 * Heuristic label/amount extraction (Thai + EN). Fail clearly when no gross found.
 */

import { isDateKey, normalizeMoney, roundMoney, type DeliveryChannel } from "./vat-sales";

export const PARSER_VERSIONS: Record<DeliveryChannel, string> = {
  grab: "grab-daily-v3",
  lineman: "lineman-daily-v2",
  shopee: "shopee-daily-v1",
};

export type ParseConfidence = "high" | "medium" | "low";

export type ReportKind = "daily" | "weekly" | "monthly";

export type ParsedPlatformReport = {
  reportDate: string;
  reportKind: ReportKind;
  /** inclusive period for weekly/monthly */
  periodStart: string | null;
  periodEnd: string | null;
  grossInclusive: number;
  fee: number;
  netTransfer: number;
  orderCount: number | null;
  currency: "THB";
  confidence: ParseConfidence;
  warnings: string[];
  parserVersion: string;
  matchedLabels: {
    gross?: string;
    fee?: string;
    net?: string;
    date?: string;
  };
};

export type ParseFail = {
  ok: false;
  error: string;
  parserVersion: string;
  warnings: string[];
};

export type ParseOk = {
  ok: true;
  parsed: ParsedPlatformReport;
};

export type ParseResult = ParseOk | ParseFail;

/** Strip tags / entities → plain text for scanning */
export function htmlToPlainText(html: string): string {
  let s = String(html || "");
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/gi, '"');
  s = s.replace(/\r/g, "");
  s = s.replace(/[ \t]+\n/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  s = s.replace(/[ \t]{2,}/g, " ");
  return s.trim();
}

export function normalizeMailBody(rawText: string, rawHtml: string): string {
  const text = String(rawText || "").trim();
  if (text.length >= 40) return text;
  const fromHtml = htmlToPlainText(rawHtml);
  if (fromHtml.length > text.length) return fromHtml;
  return text || fromHtml;
}

/** Parse amounts like 1,234.56 / 1.234,56 / 1234 / ฿1,234 */
export function parseAmountToken(raw: string): number | null {
  let s = String(raw || "").trim();
  if (!s) return null;
  s = s.replace(/[฿บาทTHB\s]/gi, "");
  // (1,234.56) → negative not used for sales — strip parens
  s = s.replace(/^\((.+)\)$/, "$1");
  if (!s || !/\d/.test(s)) return null;

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // last separator is decimal
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (hasComma && !hasDot) {
    // 1,234 or 1234,50
    const parts = s.split(",");
    if (parts.length === 2 && parts[1].length <= 2) s = `${parts[0]}.${parts[1]}`;
    else s = s.replace(/,/g, "");
  }

  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return roundMoney(n);
}

type LabelSpec = { key: "gross" | "fee" | "net" | "orders" | "date"; labels: string[] };

const SHARED_GROSS = [
  "ยอดที่ลูกค้าจ่าย",
  "ยอดลูกค้าชำระ",
  "ยอดรวมที่ลูกค้าชำระ",
  "ยอดขายรวมทั้งสิ้น",
  "ยอดขายรวมทั้งหมด",
  "มูลค่ายอดขาย",
  "ยอดขายรวม",
  "ยอดขายสุทธิ",
  "ยอดขายสินค้า",
  "ยอดรวมออเดอร์",
  "ยอดคำสั่งซื้อ",
  "ยอดขาย",
  "gross sales (incl. vat)",
  "gross sales incl. vat",
  "gross sales amount",
  "gross sales",
  "total sales amount",
  "total sales",
  "sales amount",
  "order sales",
  "sales (incl. vat)",
  "gmv",
];

const SHARED_FEE = [
  "ค่าคอมมิชชั่น",
  "ค่าคอมมิชชัน",
  "ค่าธรรมเนียมแพลตฟอร์ม",
  "ค่าบริการแพลตฟอร์ม",
  "ค่าบริการ",
  "ค่าธรรมเนียม",
  "ค่า gp",
  "commission",
  "commission fee",
  "platform fee",
  "service fee",
  "marketing fee",
];

const SHARED_NET = [
  "ยอดโอนสุทธิ",
  "ยอดโอนเข้าบัญชี",
  "ยอดที่ร้านจะได้รับ",
  "ยอดที่โอน",
  "ยอดโอนออก",
  "รวมยอดโอน",
  "ยอดโอน",
  "จำนวนเงินที่โอน",
  "รายงานยอดโอน",
  "net payout",
  "net transfer",
  "payout amount",
  "amount to be transferred",
  "settlement amount",
];

const SHARED_ORDERS = [
  "จำนวนออเดอร์",
  "จำนวนออร์เดอร์",
  "จำนวนคำสั่งซื้อ",
  "ออเดอร์ทั้งหมด",
  "total orders",
  "order count",
  "orders",
];

const CHANNEL_LABELS: Record<DeliveryChannel, LabelSpec[]> = {
  grab: [
    {
      key: "gross",
      labels: [
        "ยอดขายจากลูกค้า",
        "ยอดขายที่ลูกค้าชำระ",
        "customer paid amount",
        "customer paid",
        "gross merchandise value",
        ...SHARED_GROSS,
      ],
    },
    { key: "fee", labels: ["ค่าคอมมิชชัน grab", ...SHARED_FEE] },
    { key: "net", labels: ["ยอดเงินที่จะได้รับ", ...SHARED_NET] },
    { key: "orders", labels: SHARED_ORDERS },
  ],
  lineman: [
    {
      key: "gross",
      labels: [
        "รายรับทั้งหมด",
        "ยอดขาย e-payment",
        "ยอดขายรวม (รวมvat)",
        "ยอดขายรวม vat",
        ...SHARED_GROSS,
      ],
    },
    { key: "fee", labels: ["ค่าธรรมเนียม line man", ...SHARED_FEE] },
    { key: "net", labels: SHARED_NET },
    { key: "orders", labels: SHARED_ORDERS },
  ],
  shopee: [
    { key: "gross", labels: ["ยอดสั่งซื้อสำเร็จ", "ยอดขาย shopee", ...SHARED_GROSS] },
    { key: "fee", labels: ["ค่าบริการ shopee", "ค่าคอมฯ", ...SHARED_FEE] },
    { key: "net", labels: ["ยอดเงินเข้าบัญชี", ...SHARED_NET] },
    { key: "orders", labels: SHARED_ORDERS },
  ],
};

/** ปี ค.ศ. จาก ค.ศ. / พ.ศ. / ปีสั้นพ.ศ. (67 → 2024) */
export function toCeYear(raw: string | number): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return null;
  if (n >= 2400) return n - 543;
  if (n >= 1900) return n;
  if (n >= 0 && n < 100) return 2500 + n - 543;
  return null;
}

const THAI_MONTHS: Record<string, number> = {
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

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** ใบกำกับรายออเดอร์ — ไม่ใช่สรุปเงินเข้ารายวัน */
export function isTaxInvoiceMail(subject: string, body = ""): boolean {
  const hay = `${subject}\n${body}`.toLowerCase();
  return /tax\s*invoice|ใบกำกับภาษี|receipt\s*\/\s*tax|receipt\/tax|ใบเสร็จรับเงิน/.test(
    hay,
  );
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isTokenBoundary(ch: string | undefined) {
  if (ch == null || ch === "") return true;
  // กันจับ "ยอดขาย" กลางคำว่า "สรุปยอดขาย…"
  if (/[\u0E00-\u0E7Fa-z0-9]/i.test(ch)) return false;
  return true;
}

function findLabeledAmount(
  text: string,
  labels: string[],
): { amount: number; label: string } | null {
  const lower = text.toLowerCase();
  // Prefer longer labels first
  const sorted = [...labels].sort((a, b) => b.length - a.length);
  for (const label of sorted) {
    const needle = label.toLowerCase();
    let from = 0;
    while (from < lower.length) {
      const idx = lower.indexOf(needle, from);
      if (idx < 0) break;
      from = idx + needle.length;
      if (!isTokenBoundary(text[idx - 1]) || !isTokenBoundary(text[idx + needle.length])) {
        continue;
      }
      const window = text.slice(idx, idx + label.length + 100);
      const after = window.slice(label.length);
      const m = after.match(
        /[:\s\-–—]*([฿]\s*\d{1,3}(?:[,\s]\d{3})*(?:\.\d{1,2})?|\d{1,3}(?:[,\s]\d{3})+(?:\.\d{1,2})?|\d+\.\d{1,2}|\d{3,})/,
      );
      if (m) {
        const amount = parseAmountToken(m[1]);
        // กันเลขวัน/เดือนใกล้ป้าย (เช่น 26 หลังสรุปยอด)
        if (amount != null && amount >= 50) return { amount, label };
        if (amount != null && /[฿.]/.test(m[1])) return { amount, label };
      }
      const lineStart = text.lastIndexOf("\n", idx) + 1;
      const before = text.slice(lineStart, idx);
      const m2 = before.match(
        /([฿]?\s*\d{1,3}(?:[,\s]\d{3})*(?:\.\d{1,2})?|\d+\.\d{1,2})\s*$/,
      );
      if (m2) {
        const amount = parseAmountToken(m2[1]);
        if (amount != null && (amount >= 50 || /[฿.]/.test(m2[1]))) {
          return { amount, label };
        }
      }
    }
  }
  return null;
}

function findOrderCount(text: string, labels: string[]): number | null {
  const lower = text.toLowerCase();
  for (const label of [...labels].sort((a, b) => b.length - a.length)) {
    const idx = lower.indexOf(label.toLowerCase());
    if (idx < 0) continue;
    const window = text.slice(idx, idx + label.length + 40);
    const m = window.slice(label.length).match(/[:\s\-–—]*(\d{1,5})/);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 0 && n < 100000) return n;
    }
  }
  return null;
}

export function detectReportKind(subject: string, body = ""): ReportKind {
  const hay = `${subject}\n${body}`.toLowerCase();
  if (
    /รายเดือน|monthly|month[- ]?end|สรุปรอบเดือน|settlement\s*month|ประจำเดือน/.test(
      hay,
    )
  ) {
    return "monthly";
  }
  if (/รายสัปดาห์|weekly|week\s*ending|สัปดาห์|ประจำสัปดาห์|week[- ]?of/.test(hay)) {
    return "weekly";
  }
  return "daily";
}

/** จากวันสิ้นสุดช่วง → ต้นสัปดาห์ (ย้อน 6 วัน) หรือต้นเดือน */
export function periodBoundsForKind(
  kind: ReportKind,
  reportDate: string,
): { periodStart: string | null; periodEnd: string | null } {
  if (!isDateKey(reportDate)) return { periodStart: null, periodEnd: null };
  if (kind === "daily") return { periodStart: reportDate, periodEnd: reportDate };
  if (kind === "monthly") {
    const month = reportDate.slice(0, 7);
    return { periodStart: `${month}-01`, periodEnd: reportDate };
  }
  // weekly: end = reportDate, start = reportDate - 6 days (Bangkok calendar via UTC offset)
  const [y, m, d] = reportDate.split("-").map(Number);
  const endMs = Date.UTC(y, m - 1, d) - 7 * 60 * 60 * 1000;
  const startMs = endMs - 6 * 24 * 60 * 60 * 1000;
  const fmt = (ms: number) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(ms));
    const get = (t: string) => parts.find((p) => p.type === t)?.value || "0";
    return `${get("year")}-${get("month")}-${get("day")}`;
  };
  return { periodStart: fmt(startMs), periodEnd: reportDate };
}

export function extractReportDate(
  subject: string,
  body: string,
  fallbackMs?: number,
): { date: string; label?: string } | null {
  const hay = `${subject}\n${body.slice(0, 2500)}`;

  // 26 กรกฎาคม 2024 / 27 ก.ค. 2567
  const thMonthAlt = Object.keys(THAI_MONTHS)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
  const thRe = new RegExp(
    `(\\d{1,2})\\s*(${thMonthAlt})\\.?\\s*(25\\d{2}|20\\d{2}|\\d{2})`,
    "i",
  );
  const th = hay.match(thRe);
  const plausible = (y: number, month: number, day: number) =>
    y >= 2018 && y <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31;

  if (th) {
    const day = Number(th[1]);
    const monthKey = th[2].replace(/\.$/, "");
    const month = THAI_MONTHS[monthKey] || THAI_MONTHS[th[2]];
    const year = toCeYear(th[3]);
    if (month && year && plausible(year, month, day)) {
      const date = `${year}-${pad2(month)}-${pad2(day)}`;
      if (isDateKey(date)) return { date, label: "thai-month" };
    }
  }

  // ISO / พ.ศ. เต็มก่อน — กัน 2026/07/21 ถูกอ่านเป็น 26/07/21
  const iso = hay.match(/(?<!\d)(20\d{2}|25\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})(?!\d)/);
  if (iso) {
    const year = toCeYear(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (year && plausible(year, month, day)) {
      const date = `${year}-${pad2(month)}-${pad2(day)}`;
      if (isDateKey(date)) return { date, label: "iso-like" };
    }
  }

  // 27/07/2567 · 27/07/2024
  const dmy4 = hay.match(/(?<!\d)(\d{1,2})[./](\d{1,2})[./](20\d{2}|25\d{2})(?!\d)/);
  if (dmy4) {
    const day = Number(dmy4[1]);
    const month = Number(dmy4[2]);
    const year = toCeYear(dmy4[3]);
    if (year && plausible(year, month, day)) {
      const date = `${year}-${pad2(month)}-${pad2(day)}`;
      if (isDateKey(date)) return { date, label: "dmy" };
    }
  }

  // 27/07/67 (ปีสั้นพ.ศ.)
  const dmy2 = hay.match(/(?<!\d)(\d{1,2})[./](\d{1,2})[./](\d{2})(?!\d)/);
  if (dmy2) {
    const day = Number(dmy2[1]);
    const month = Number(dmy2[2]);
    const year = toCeYear(dmy2[3]);
    if (year && plausible(year, month, day)) {
      const date = `${year}-${pad2(month)}-${pad2(day)}`;
      if (isDateKey(date)) return { date, label: "dmy-be2" };
    }
  }
  if (fallbackMs && Number.isFinite(fallbackMs)) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(fallbackMs));
    const get = (t: string) => parts.find((p) => p.type === t)?.value || "0";
    return { date: `${get("year")}-${get("month")}-${get("day")}`, label: "receivedAt" };
  }
  return null;
}

function confidenceFromHits(grossLabel: string | undefined, fee: number, net: number): ParseConfidence {
  if (!grossLabel) return "low";
  if (fee > 0 || net > 0) return "high";
  if (/ลูกค้า|customer|gmv|gross|รายรับทั้งหมด/i.test(grossLabel)) return "high";
  if (/ยอดขายรวม|total sales|ยอดขาย/i.test(grossLabel)) return "medium";
  return "medium";
}

/**
 * เมลยอดโอนอย่างเดียว (เช่น LINE MAN รายงานยอดโอนออก) — ไม่บังคับยอดขาย
 */
export function parseMailNetTransfer(input: {
  channel: DeliveryChannel | "unknown";
  subject?: string;
  rawText?: string;
  rawHtml?: string;
}): { ok: true; netTransfer: number; label: string } | { ok: false; error: string } {
  const channel = input.channel;
  if (channel === "unknown") {
    return { ok: false, error: "ไม่ทราบช่องทาง" };
  }
  const body = normalizeMailBody(input.rawText || "", input.rawHtml || "");
  const subject = String(input.subject || "");
  const hay = `${subject}\n${body}`;
  if (hay.trim().length < 8) {
    return { ok: false, error: "เนื้อเมลว่าง" };
  }
  const netLabels = [
    ...(CHANNEL_LABELS[channel].find((s) => s.key === "net")?.labels || []),
    ...SHARED_NET,
  ];
  const hit = findLabeledAmount(hay, netLabels);
  if (!hit) {
    // บางฉบับมีแค่ตัวเลขหลักหลังหัวข้อโอน
    if (/ยอดโอน|โอนออก|payout|settlement/i.test(hay)) {
      const m = hay.match(
        /([฿]\s*\d{1,3}(?:[,\s]\d{3})*(?:\.\d{1,2})?|\d{1,3}(?:[,\s]\d{3})+(?:\.\d{1,2})?|\d+\.\d{2})/,
      );
      if (m) {
        const amount = parseAmountToken(m[1]);
        if (amount != null && amount >= 50) {
          return { ok: true, netTransfer: amount, label: "amount-fallback" };
        }
      }
    }
    return { ok: false, error: "หาป้ายยอดโอนไม่เจอ" };
  }
  return { ok: true, netTransfer: hit.amount, label: hit.label };
}

export function parsePlatformEmail(input: {
  channel: DeliveryChannel | "unknown";
  subject?: string;
  rawText?: string;
  rawHtml?: string;
  reportDateGuess?: string;
  receivedAt?: number;
}): ParseResult {
  const channel = input.channel;
  if (channel === "unknown") {
    return {
      ok: false,
      error: "ไม่ทราบช่องทาง — ระบุ Shopee/Grab/LINE MAN ก่อน parse",
      parserVersion: "unknown-v0",
      warnings: [],
    };
  }

  const parserVersion = PARSER_VERSIONS[channel];
  const body = normalizeMailBody(input.rawText || "", input.rawHtml || "");
  const subject = String(input.subject || "");
  const warnings: string[] = [];

  if (isTaxInvoiceMail(subject, body)) {
    return {
      ok: false,
      error: "เมลใบกำกับ/Tax Invoice — ไม่ใช่สรุปเงินเข้ารายวัน (ข้ามได้)",
      parserVersion,
      warnings: ["tax_invoice"],
    };
  }

  if (body.length < 20 && subject.length < 5) {
    return { ok: false, error: "เนื้อเมลว่างเกินไป", parserVersion, warnings };
  }

  const specs = CHANNEL_LABELS[channel];
  const grossSpec = specs.find((s) => s.key === "gross")!;
  const feeSpec = specs.find((s) => s.key === "fee")!;
  const netSpec = specs.find((s) => s.key === "net")!;
  const orderSpec = specs.find((s) => s.key === "orders")!;

  const hay = `${subject}\n${body}`;
  const grossHit = findLabeledAmount(hay, grossSpec.labels);
  if (!grossHit) {
    const pdfHint = /\.pdf|ไฟล์แนบ|เอกสารแนบ|attached file|ได้ถูกสรุปเป็นไฟล์แนบ/i.test(hay);
    return {
      ok: false,
      error: pdfHint
        ? "ยอดอยู่ใน PDF แนบ — ยังไม่ดึงจาก PDF อัตโนมัติ (เปิดแนบแล้วกรอกมือได้)"
        : "หาป้ายยอดขาย/ยอดลูกค้าไม่เจอ — ตรวจรูปแบบเมลหรือกรอกมือ",
      parserVersion,
      warnings: pdfHint ? ["pdf_attachment"] : warnings,
    };
  }

  const feeHit = findLabeledAmount(hay, feeSpec.labels);
  const netHit = findLabeledAmount(hay, netSpec.labels);
  const orderCount = findOrderCount(hay, orderSpec.labels);

  let reportDate = "";
  let dateLabel: string | undefined;
  if (input.reportDateGuess && isDateKey(input.reportDateGuess)) {
    reportDate = input.reportDateGuess;
    dateLabel = "reportDateGuess";
  } else {
    const extracted = extractReportDate(subject, body, input.receivedAt);
    if (extracted) {
      reportDate = extracted.date;
      dateLabel = extracted.label;
    }
  }
  if (!reportDate) {
    return {
      ok: false,
      error: "หาวันที่รายงานไม่เจอ",
      parserVersion,
      warnings,
    };
  }

  const grossInclusive = normalizeMoney(grossHit.amount);
  const fee = normalizeMoney(feeHit?.amount || 0);
  const netTransfer = normalizeMoney(netHit?.amount || 0);

  if (fee > grossInclusive && grossInclusive > 0) {
    warnings.push("ค่าธรรมเนียมมากกว่ายอดขาย — ตรวจอีกครั้ง");
  }
  if (netTransfer > 0 && grossInclusive > 0 && netTransfer > grossInclusive * 1.05) {
    warnings.push("ยอดโอนสุทธิสูงกว่ายอดลูกค้าผิดปกติ");
  }
  if (!feeHit) warnings.push("ไม่พบค่าธรรมเนียมในเมล (เป็น 0 ได้)");
  if (!netHit) warnings.push("ไม่พบยอดโอนสุทธิในเมล (เป็น 0 ได้)");

  // Avoid mistaking tiny order counts as gross — already separate.
  // If gross looks like order count (integer < 50) and another larger amount exists near "บาท"
  if (grossInclusive > 0 && grossInclusive < 50 && Number.isInteger(grossInclusive)) {
    warnings.push("ยอดขายต่ำผิดปกติ อาจจับจำนวนออเดอร์แทนยอดเงิน");
  }

  const reportKind = detectReportKind(subject, body);
  const { periodStart, periodEnd } = periodBoundsForKind(reportKind, reportDate);
  if (reportKind !== "daily") {
    warnings.push(`จัดเป็นรายงาน${reportKind === "weekly" ? "รายสัปดาห์" : "รายเดือน"} — ใช้เทียบยอด ไม่ใส่ตารางรายวันอัตโนมัติ`);
  }

  return {
    ok: true,
    parsed: {
      reportDate,
      reportKind,
      periodStart,
      periodEnd,
      grossInclusive,
      fee,
      netTransfer,
      orderCount,
      currency: "THB",
      confidence: confidenceFromHits(grossHit.label, fee, netTransfer),
      warnings,
      parserVersion,
      matchedLabels: {
        gross: grossHit.label,
        ...(feeHit ? { fee: feeHit.label } : {}),
        ...(netHit ? { net: netHit.label } : {}),
        ...(dateLabel ? { date: dateLabel } : {}),
      },
    },
  };
}

/** Re-export escape for tests */
export function _testOnly_escapeRegExp(s: string) {
  return escapeRegExp(s);
}
