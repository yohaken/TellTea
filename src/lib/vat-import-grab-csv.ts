/**
 * อะแดปเตอร์ Grab — CSV Transaction_Store / รายงานธุรกรรมร้าน
 * จับคอลัมน์แบบยืดหยุ่นจากชื่อหัวตาราง
 *
 * แถววัน: รวม gross / fee / net ต่อวัน
 */
import { gpVatFromFee } from "./personal-income-tax";
import { normalizeMoney, roundMoney } from "./vat-sales";
import {
  isDateKey,
  monthKeyFromDateKey,
  type VatImportRowInput,
} from "./vat-import";

export const GRAB_CSV_ADAPTER_ID = "grab-transaction-csv";
export const GRAB_CSV_ADAPTER_VERSION = "1";

export type GrabCsvDay = {
  dateKey: string;
  grossInclusive: number;
  fee: number;
  netTransfer: number;
  gpVat: number;
  lineCount: number;
};

export type GrabCsvParseResult = {
  adapterId: typeof GRAB_CSV_ADAPTER_ID;
  adapterVersion: typeof GRAB_CSV_ADAPTER_VERSION;
  monthKey: string;
  days: GrabCsvDay[];
  warnings: string[];
  headers: string[];
  /** รวมภาษีจากคอลัมน์แยก (ถ้ามี) — ไม่คำนวณจาก fee */
  taxColumnTotal: number;
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
  return Number.isFinite(n) ? roundMoney(n) : 0;
}

/** รองรับ 2026-07-01 · 01/07/2026 · 1/7/2026 · 2026/07/01 */
export function parseGrabDateCell(raw: string): string {
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
  const ymd = t.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (ymd) {
    const k = `${ymd[1]}-${ymd[2]!.padStart(2, "0")}-${ymd[3]!.padStart(2, "0")}`;
    return isDateKey(k) ? k : "";
  }
  return "";
}

/** ไฟล์สรุปร้านสั้น — ไม่ใช้ (ต้องเป็น Transaction_Store_… รายละเอียดรายการ) */
export function isGrabStoresSummaryFileName(fileName: string): boolean {
  return /Transaction_Stores_/i.test(String(fileName || ""));
}

export function looksLikeGrabTransactionStoreFileName(fileName: string): boolean {
  const n = String(fileName || "");
  return /Transaction_Store_/i.test(n) && !isGrabStoresSummaryFileName(n);
}

export function looksLikeGrabTransactionCsv(text: string): boolean {
  const rows = parseCsv(text);
  if (rows.length < 2) return false;
  const header = rows[0]!.join(" ").toLowerCase();
  const hasDate =
    /date|วันที่|transaction time|create time/.test(header);
  const hasMoney =
    /amount|sales|gross|commission|fee|net|payout|ยอด|ค่าคอม|โอน|ทั้งหมด/.test(
      header,
    );
  return hasDate && hasMoney;
}

export function parseGrabTransactionCsv(text: string): GrabCsvParseResult {
  const warnings: string[] = [];
  const table = parseCsv(text);
  if (table.length < 2) {
    return {
      adapterId: GRAB_CSV_ADAPTER_ID,
      adapterVersion: GRAB_CSV_ADAPTER_VERSION,
      monthKey: "",
      days: [],
      warnings: ["CSV ว่างหรือไม่มีข้อมูล"],
      headers: [],
      taxColumnTotal: 0,
    };
  }
  const headers = table[0]!;
  const dateIdx = findCol(headers, [
    /^date$/,
    /transaction date/,
    /transaction time/,
    /create time/,
    /วันที่/,
    /^day$/,
  ]);
  const grossIdx = findCol(headers, [
    /ยอดขายสุทธิ/,
    /gross sales/,
    /gross amount/,
    /basket amount/,
    /order value/,
    /ยอดขาย/,
    /sales amount/,
    /^gross$/,
  ]);
  const feeIdx = findCol(headers, [
    /ค่าคอมมิชชันแพลตฟอร์ม/,
    /ค่าคอมมิชชั่นแพลตฟอร์ม/,
    /commission/,
    /grab fee/,
    /merchant fee/,
    /ค่าคอม/,
    /ค่าธรรมเนียม/,
    /^fee$/,
  ]);
  const netIdx = findCol(headers, [
    /^ทั้งหมด$/,
    /net payout/,
    /net sales/,
    /net amount/,
    /payout/,
    /ยอดโอน/,
    /settlement/,
    /^net$/,
  ]);
  const taxIdx = findCol(headers, [
    /ภาษีค่าคอมมิชชัน/,
    /ภาษีค่าคอมมิชชั่น/,
    /commission tax/,
    /tax on commission/,
  ]);
  const amountIdx = findCol(headers, [/^amount$/, /transaction amount/]);

  if (dateIdx < 0) warnings.push("ไม่พบคอลัมน์วันที่");
  if (grossIdx < 0 && amountIdx < 0) {
    warnings.push("ไม่พบคอลัมน์ยอดขาย/Amount");
  }

  const byDay = new Map<string, GrabCsvDay>();
  let taxColumnTotal = 0;
  for (let r = 1; r < table.length; r++) {
    const row = table[r]!;
    const dateKey = dateIdx >= 0 ? parseGrabDateCell(row[dateIdx] || "") : "";
    if (!dateKey) continue;
    let gross = grossIdx >= 0 ? parseMoneyCell(row[grossIdx] || "") : 0;
    let fee = feeIdx >= 0 ? parseMoneyCell(row[feeIdx] || "") : 0;
    let net = netIdx >= 0 ? parseMoneyCell(row[netIdx] || "") : 0;
    const tax = taxIdx >= 0 ? parseMoneyCell(row[taxIdx] || "") : 0;
    // ค่าคอม/ภาษีใน CSV Grab มักเป็นลบ — ใช้สัมบูรณ์
    fee = Math.abs(fee);
    const taxAbs = Math.abs(tax);
    taxColumnTotal = roundMoney(taxColumnTotal + taxAbs);
    if (!(gross > 0) && amountIdx >= 0) {
      const amt = parseMoneyCell(row[amountIdx] || "");
      // ถ้ามีแค่ Amount และไม่มี fee/net — นับเป็นยอดขาย
      if (amt > 0 && feeIdx < 0 && netIdx < 0) gross = amt;
    }
    net = Math.abs(net);
    gross = Math.abs(gross);
    if (!(net > 0) && gross > 0 && fee > 0) {
      net = roundMoney(Math.max(0, gross - fee));
    }
    if (!(fee > 0) && gross > 0 && net > 0 && net < gross) {
      fee = roundMoney(gross - net);
    }
    const prev = byDay.get(dateKey) || {
      dateKey,
      grossInclusive: 0,
      fee: 0,
      netTransfer: 0,
      gpVat: 0,
      lineCount: 0,
    };
    prev.grossInclusive = normalizeMoney(prev.grossInclusive + gross);
    prev.fee = normalizeMoney(prev.fee + fee);
    prev.netTransfer = normalizeMoney(prev.netTransfer + net);
    prev.lineCount += 1;
    byDay.set(dateKey, prev);
  }

  const days = [...byDay.values()]
    .map((d) => ({
      ...d,
      gpVat: gpVatFromFee(d.fee, "incVat", 7),
    }))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));

  if (days.length === 0) warnings.push("ไม่มีแถวที่แปลงเป็นวันได้");
  const monthKey = days[0] ? monthKeyFromDateKey(days[0].dateKey) : "";

  return {
    adapterId: GRAB_CSV_ADAPTER_ID,
    adapterVersion: GRAB_CSV_ADAPTER_VERSION,
    monthKey,
    days,
    warnings,
    headers,
    taxColumnTotal: normalizeMoney(taxColumnTotal),
  };
}

export function grabCsvToImportRows(
  parsed: GrabCsvParseResult,
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
    channel: "grab" as const,
    rowKind: "sales" as const,
    grossInclusive: d.grossInclusive,
    fee: d.fee,
    netTransfer: d.netTransfer,
    gpVat: d.gpVat,
    invoiceNo: "",
    invoiceDate: "",
    sellerTaxId: "",
    storagePath: opts?.storagePath || "",
    downloadUrl: opts?.downloadUrl || "",
    fileName: opts?.fileName || "",
    contentType: opts?.contentType || "text/csv",
    contentHash: opts?.contentHash || "",
    adapterId: GRAB_CSV_ADAPTER_ID,
    adapterVersion: GRAB_CSV_ADAPTER_VERSION,
    externalId: `grab-day:${d.dateKey}`,
    status: "draft" as const,
    note: `Grab CSV · ${d.lineCount} บรรทัด`,
    appliedAt: null,
    appliedToMonth: "",
  }));
}

