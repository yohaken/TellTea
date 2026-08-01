/**
 * LINE MAN — ไฟล์แนบเมล GP ประจำเดือน `REPORT_*.csv`
 * คอลัมน์หลัก: summary_date · total_revenue · gp_fee_with_vat · payout
 * คชจ. รวม VAT แล้ว · VAT-ซื้อ = ×7/107
 */
import { gpVatFromFee } from "./personal-income-tax";
import { normalizeMoney, roundMoney } from "./vat-sales";
import { isDateKey, monthKeyFromDateKey } from "./vat-import";

export const LINEMAN_REPORT_CSV_ADAPTER_ID = "lineman-report-csv";
export const LINEMAN_REPORT_CSV_ADAPTER_VERSION = "1";

export type LinemanReportCsvParseResult = {
  adapterId: typeof LINEMAN_REPORT_CSV_ADAPTER_ID;
  adapterVersion: typeof LINEMAN_REPORT_CSV_ADAPTER_VERSION;
  monthKey: string;
  sales: number;
  transfer: number;
  /** คชจ.GP รวม VAT */
  feeInclVat: number;
  gpVat: number;
  dayCount: number;
  headers: string[];
  warnings: string[];
};

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQ = !inQ;
      }
      continue;
    }
    if (ch === "," && !inQ) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function parseCsv(text: string): string[][] {
  return String(text || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0)
    .map(splitCsvLine);
}

function normHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, " ");
}

function findCol(headers: string[], patterns: RegExp[]): number {
  const norms = headers.map(normHeader);
  for (const re of patterns) {
    const i = norms.findIndex((h) => re.test(h));
    if (i >= 0) return i;
  }
  return -1;
}

function parseMoneyCell(raw: string): number {
  const t = String(raw || "")
    .trim()
    .replace(/[฿,"\s]/g, "")
    .replace(/\((.*)\)/, "-$1");
  if (!t || t === "-") return 0;
  const n = Number(t);
  return Number.isFinite(n) ? roundMoney(Math.abs(n)) : 0;
}

function parseDateCell(raw: string): string {
  const t = String(raw || "").trim();
  if (!t) return "";
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const k = `${iso[1]}-${iso[2]}-${iso[3]}`;
    return isDateKey(k) ? k : "";
  }
  const dmy = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) {
    const k = `${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}`;
    return isDateKey(k) ? k : "";
  }
  return "";
}

/** ชื่อไฟล์ REPORT_MAY26.csv / REPORT_JUL26.csv */
export function looksLikeLinemanReportCsvFileName(fileName: string): boolean {
  return /^REPORT_[A-Za-z0-9]+\.csv$/i.test(String(fileName || "").trim());
}

export function looksLikeLinemanReportCsv(text: string): boolean {
  const rows = parseCsv(text);
  if (rows.length < 2) return false;
  const header = rows[0]!.map(normHeader).join(" | ");
  const hasRev = /total revenue|total_revenue|ยอดขาย/.test(header);
  const hasGp = /gp fee|gp_fee|ค่า.?gp|ค่าบริการ/.test(header);
  const hasPay = /payout|ยอดโอน/.test(header);
  return hasRev && hasGp && hasPay;
}

export function parseLinemanReportCsv(
  text: string,
): LinemanReportCsvParseResult {
  const warnings: string[] = [];
  const table = parseCsv(text);
  if (table.length < 2) {
    return {
      adapterId: LINEMAN_REPORT_CSV_ADAPTER_ID,
      adapterVersion: LINEMAN_REPORT_CSV_ADAPTER_VERSION,
      monthKey: "",
      sales: 0,
      transfer: 0,
      feeInclVat: 0,
      gpVat: 0,
      dayCount: 0,
      headers: [],
      warnings: ["CSV ว่างหรือไม่มีข้อมูล"],
    };
  }
  const headers = table[0]!;
  const dateIdx = findCol(headers, [
    /^summary date$/,
    /summary_date/,
    /^date$/,
    /วันที่/,
  ]);
  const salesIdx = findCol(headers, [
    /^total revenue$/,
    /total_revenue/,
    /ยอดขาย/,
  ]);
  const feeIdx = findCol(headers, [
    /^gp fee with vat$/,
    /gp_fee_with_vat/,
    /gp fee.*vat/,
    /ค่า.?gp.*vat/,
    /ค่าบริการ.*vat/,
  ]);
  const payIdx = findCol(headers, [/^payout$/, /ยอดโอน/, /โอนออก/]);

  if (dateIdx < 0) warnings.push("ไม่พบคอลัมน์ summary_date");
  if (salesIdx < 0) warnings.push("ไม่พบคอลัมน์ total_revenue");
  if (feeIdx < 0) warnings.push("ไม่พบคอลัมน์ gp_fee_with_vat");
  if (payIdx < 0) warnings.push("ไม่พบคอลัมน์ payout");

  let sales = 0;
  let transfer = 0;
  let feeInclVat = 0;
  let dayCount = 0;
  let firstDate = "";
  for (let r = 1; r < table.length; r++) {
    const row = table[r]!;
    const dateKey = dateIdx >= 0 ? parseDateCell(row[dateIdx] || "") : "";
    const s = salesIdx >= 0 ? parseMoneyCell(row[salesIdx] || "") : 0;
    const f = feeIdx >= 0 ? parseMoneyCell(row[feeIdx] || "") : 0;
    const p = payIdx >= 0 ? parseMoneyCell(row[payIdx] || "") : 0;
    if (!(s > 0 || f > 0 || p > 0)) continue;
    sales = roundMoney(sales + s);
    feeInclVat = roundMoney(feeInclVat + f);
    transfer = roundMoney(transfer + p);
    dayCount += 1;
    if (!firstDate && dateKey) firstDate = dateKey;
  }

  if (dayCount === 0) warnings.push("ไม่มีแถวที่รวมได้");
  const gpVat = feeInclVat > 0 ? gpVatFromFee(feeInclVat, "incVat", 7) : 0;
  const monthKey = firstDate ? monthKeyFromDateKey(firstDate) : "";

  return {
    adapterId: LINEMAN_REPORT_CSV_ADAPTER_ID,
    adapterVersion: LINEMAN_REPORT_CSV_ADAPTER_VERSION,
    monthKey,
    sales: normalizeMoney(sales),
    transfer: normalizeMoney(transfer),
    feeInclVat: normalizeMoney(feeInclVat),
    gpVat: normalizeMoney(gpVat),
    dayCount,
    headers,
    warnings,
  };
}
