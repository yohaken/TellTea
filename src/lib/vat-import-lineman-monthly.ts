/**
 * อะแดปเตอร์ LINE MAN — รายงานยอดขายประจำเดือน (PDF)
 * มีทั้งสรุปเดือน + ตารางรายวัน · ค่า GP รวม VAT แล้ว
 *
 * แมป:
 * - grossInclusive = ยอดขายเงินสด + E-Payment
 * - fee = ค่า GP (รวม VAT)
 * - netTransfer = ยอดเงินในระบบ (ขาย − GP) — ไม่ใช้ยอดโอนธนาคารรายวัน
 * - gpVat = fee × 7/107
 */
import { gpVatFromFee } from "./personal-income-tax";
import { normalizeMoney, roundMoney } from "./vat-sales";
import type { VatImportRowInput } from "./vat-import";

export const LINEMAN_MONTHLY_ADAPTER_ID = "lineman-monthly-pdf";
export const LINEMAN_MONTHLY_ADAPTER_VERSION = "1";

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
};

export type LinemanMonthlyParseResult = {
  adapterId: typeof LINEMAN_MONTHLY_ADAPTER_ID;
  adapterVersion: typeof LINEMAN_MONTHLY_ADAPTER_VERSION;
  monthKey: string;
  storeLabel: string;
  monthGross: number;
  monthFeeInclVat: number;
  monthTransferOut: number;
  days: Array<{
    dateKey: string;
    cashSales: number;
    epaySales: number;
    grossInclusive: number;
    feeInclVat: number;
    /** ยอดเงินในระบบ ≈ ขาย − GP */
    systemBalance: number;
    bankTransferOut: number;
    gpVat: number;
  }>;
  warnings: string[];
};

function parseMoneyToken(raw: string): number {
  const t = String(raw || "")
    .trim()
    .replace(/[฿,\s]/g, "");
  if (!t || t === "-") return 0;
  const n = Number(t);
  return Number.isFinite(n) ? roundMoney(n) : 0;
}

/** ยุบช่องว่างซ้ำ — ทนข้อความจาก pdfjs */
export function normalizePdfText(text: string): string {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}

/** ตรวจว่าข้อความน่าจะเป็นรายงานประจำเดือน LINE MAN */
export function looksLikeLinemanMonthlyReport(text: string): boolean {
  const t = normalizePdfText(text);
  return (
    /ค่า\s*GP\s*\(\s*รวม\s*VAT\s*\)/.test(t) &&
    (t.includes("รายงานยอดขายประจำเดือน") || t.includes("สรุปรายวัน")) &&
    (t.includes("ยอดโอนออกให้ร้าน") || t.includes("ยอดโอนให้ร้าน"))
  );
}

export function parseLinemanMonthKey(text: string): string {
  // รายงานยอดขายประจำเดือน มิถุนายน 2026
  const mTh = text.match(
    /รายงานยอดขายประจำเดือน\s*([ก-๙]+)\s+(\d{4})/,
  );
  if (mTh) {
    const month = THAI_MONTHS[mTh[1]!];
    const year = Number(mTh[2]);
    if (month && year >= 2000) {
      return `${year}-${String(month).padStart(2, "0")}`;
    }
  }
  // fallback: first day row 01/06/2026
  const mDay = text.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  if (mDay) {
    return `${mDay[3]}-${mDay[2]}`;
  }
  return "";
}

function parseStoreLabel(text: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    if (/^หมายเลขร้าน/.test(lines[i]!)) {
      return lines[i + 1] || "";
    }
  }
  return "";
}

function parseMonthTotals(text: string): {
  monthGross: number;
  monthFeeInclVat: number;
  monthTransferOut: number;
} {
  const gross =
    text.match(/รายรับทั้งหมด\s*฿?\s*([\d,]+\.\d{2})/) ||
    text.match(/ยอดขาย E-Payment\s+([\d,]+\.\d{2})/);
  const fee =
    text.match(/ค่า GP \(รวม VAT\)\s+([\d,]+\.\d{2})/) ||
    text.match(/ค่าบริการ\s*฿?\s*([\d,]+\.\d{2})/);
  const transfer = text.match(
    /ยอดโอนออกให้ร้าน\s*฿?\s*([\d,]+\.\d{2})/,
  );
  // แถวรวมท้ายตาราง: รวม 0.00 42,504.00 13,643.97 ...
  const totalRow = text.match(
    /รวม\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+[-\d,]+\s+([\d,]+\.\d{2})/,
  );
  return {
    monthGross: parseMoneyToken(
      totalRow?.[2] || gross?.[1] || "0",
    ),
    monthFeeInclVat: parseMoneyToken(
      totalRow?.[3] || fee?.[1] || "0",
    ),
    monthTransferOut: parseMoneyToken(
      totalRow?.[6] || transfer?.[1] || "0",
    ),
  };
}

/**
 * แถววัน:
 * วันที่ ยอดขายเงินสด ยอดขาย E-Payment ค่า GP (รวม VAT) ค่าบริการที่ชำระแล้ว ปรับยอด/อื่นๆ ยอดเงินในระบบ ยอดโอนออกให้ร้าน*
 */
export function parseLinemanDailyRows(text: string): LinemanMonthlyParseResult["days"] {
  const re =
    /(\d{2})\/(\d{2})\/(\d{4})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/g;
  const days: LinemanMonthlyParseResult["days"] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const dd = m[1]!;
    const mm = m[2]!;
    const yyyy = m[3]!;
    const cashSales = parseMoneyToken(m[4]!);
    const epaySales = parseMoneyToken(m[5]!);
    const feeInclVat = parseMoneyToken(m[6]!);
    const systemBalance = parseMoneyToken(m[9]!);
    const bankTransferOut = parseMoneyToken(m[10]!);
    const grossInclusive = roundMoney(cashSales + epaySales);
    days.push({
      dateKey: `${yyyy}-${mm}-${dd}`,
      cashSales,
      epaySales,
      grossInclusive,
      feeInclVat,
      systemBalance,
      bankTransferOut,
      gpVat: gpVatFromFee(feeInclVat, "incVat", 7),
    });
  }
  // เรียงตามวัน
  days.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  return days;
}

export function parseLinemanMonthlyReport(
  text: string,
): LinemanMonthlyParseResult {
  const body = normalizePdfText(text);
  const warnings: string[] = [];
  if (!looksLikeLinemanMonthlyReport(body)) {
    warnings.push("ข้อความไม่เหมือนรายงานประจำเดือน LINE MAN");
  }
  const monthKey = parseLinemanMonthKey(body);
  if (!monthKey) warnings.push("อ่านเดือนจากรายงานไม่ได้");
  const totals = parseMonthTotals(body);
  const days = parseLinemanDailyRows(body);
  if (days.length === 0) warnings.push("ไม่พบแถวสรุปรายวัน");

  const sumGross = roundMoney(
    days.reduce((s, d) => s + d.grossInclusive, 0),
  );
  const sumFee = roundMoney(days.reduce((s, d) => s + d.feeInclVat, 0));
  if (totals.monthGross > 0 && Math.abs(sumGross - totals.monthGross) > 0.05) {
    warnings.push(
      `Σ ยอดขายรายวัน ${sumGross} ≠ สรุปเดือน ${totals.monthGross}`,
    );
  }
  if (
    totals.monthFeeInclVat > 0 &&
    Math.abs(sumFee - totals.monthFeeInclVat) > 0.05
  ) {
    warnings.push(
      `Σ GP รายวัน ${sumFee} ≠ สรุปเดือน ${totals.monthFeeInclVat}`,
    );
  }

  return {
    adapterId: LINEMAN_MONTHLY_ADAPTER_ID,
    adapterVersion: LINEMAN_MONTHLY_ADAPTER_VERSION,
    monthKey,
    storeLabel: parseStoreLabel(body),
    monthGross: totals.monthGross || sumGross,
    monthFeeInclVat: totals.monthFeeInclVat || sumFee,
    monthTransferOut: totals.monthTransferOut,
    days,
    warnings,
  };
}

/** แปลงผล parse → แถวนำเข้า (ยังไม่เขียน Firestore) */
export function linemanMonthlyToImportRows(
  parsed: LinemanMonthlyParseResult,
  opts?: {
    storagePath?: string;
    downloadUrl?: string;
    fileName?: string;
    contentType?: string;
    contentHash?: string;
  },
): VatImportRowInput[] {
  if (!parsed.monthKey) return [];
  return parsed.days.map((d) => ({
    monthKey: parsed.monthKey,
    dateKey: d.dateKey,
    channel: "lineman" as const,
    rowKind: "sales" as const,
    grossInclusive: normalizeMoney(d.grossInclusive),
    fee: normalizeMoney(d.feeInclVat),
    netTransfer: normalizeMoney(d.systemBalance),
    gpVat: normalizeMoney(d.gpVat),
    invoiceNo: "",
    invoiceDate: "",
    sellerTaxId: "",
    storagePath: opts?.storagePath || "",
    downloadUrl: opts?.downloadUrl || "",
    fileName: opts?.fileName || "",
    contentType: opts?.contentType || "application/pdf",
    contentHash: opts?.contentHash || "",
    adapterId: LINEMAN_MONTHLY_ADAPTER_ID,
    adapterVersion: LINEMAN_MONTHLY_ADAPTER_VERSION,
    externalId: `lm-day:${d.dateKey}`,
    status: "draft" as const,
    note: "LINE MAN รายงานเดือน · GP รวม VAT · โอนหลัง=ยอดเงินในระบบ",
    appliedAt: null,
    appliedToMonth: "",
  }));
}
