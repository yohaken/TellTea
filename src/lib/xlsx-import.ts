import * as XLSX from "xlsx";
import type { LedgerEntryInput } from "./types";
import { parseDateInput } from "./utils";
import { canonicalLedgerType, labelLedgerType } from "./ledger-labels";

export type ImportLedgerRow = LedgerEntryInput & {
  createdAt: number;
  sourceRow: number;
};

export { labelLedgerType };

function excelSerialToLocalMidnight(serial: number): number {
  const parsed = XLSX.SSF.parse_date_code(serial);
  if (!parsed) throw new Error(`วันที่ Excel ไม่ถูกต้อง: ${serial}`);
  return new Date(parsed.y, parsed.m - 1, parsed.d).getTime();
}

function toNumber(value: unknown): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return value;
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function cellToDateMs(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return excelSerialToLocalMidnight(value);
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text) || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(text)) {
    return parseDateInput(text);
  }
  const asDate = new Date(text);
  if (!Number.isNaN(asDate.getTime())) {
    return new Date(asDate.getFullYear(), asDate.getMonth(), asDate.getDate()).getTime();
  }
  return null;
}

function findHeaderIndex(rows: unknown[][]): number {
  return rows.findIndex((row) => {
    const cells = (row || []).map((c) => String(c ?? "").trim());
    return cells.includes("วันที่") && cells.includes("รายการ");
  });
}

function mapHeader(row: unknown[]) {
  const map: Record<string, number> = {};
  row.forEach((cell, i) => {
    const key = String(cell ?? "").trim();
    if (key) map[key] = i;
  });
  return map;
}

/** Parse TellTea sheet: วันที่ | รายการ | เข้า | ออก | คงเหลือ | type */
export function parseLedgerWorkbook(
  data: ArrayBuffer | Uint8Array,
  createdBy: string,
): ImportLedgerRow[] {
  const workbook = XLSX.read(data, { type: "array", cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("ไม่พบชีทในไฟล์");

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    defval: null,
    raw: true,
  }) as unknown[][];

  const headerIndex = findHeaderIndex(rows);
  if (headerIndex < 0) {
    throw new Error("ไม่พบหัวตาราง วันที่ / รายการ / เข้า / ออก");
  }

  const header = mapHeader(rows[headerIndex] || []);
  const colDate = header["วันที่"];
  const colDesc = header["รายการ"];
  const colIn = header["เข้า"];
  const colOut = header["ออก"];
  const colType = header["type"] ?? header["Type"] ?? header["หมวด"];

  if (colDate == null || colDesc == null || colIn == null || colOut == null) {
    throw new Error("คอลัมน์ไม่ครบ — ต้องมี วันที่, รายการ, เข้า, ออก");
  }

  const parsed: Omit<ImportLedgerRow, "createdAt">[] = [];

  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const description = String(row[colDesc] ?? "").trim();
    if (!description) continue;

    const amountIn = toNumber(row[colIn]);
    const amountOut = toNumber(row[colOut]);
    if (amountIn <= 0 && amountOut <= 0) continue;

    const dateMs = cellToDateMs(row[colDate]);
    if (dateMs == null) {
      throw new Error(`แถว ${i + 1}: วันที่ไม่ถูกต้อง (${String(row[colDate])})`);
    }

    let type = colType != null ? String(row[colType] ?? "").trim() : "";
    if (!type && amountIn > 0) {
      type = description.includes("ยกมา") ? "ยอดยกมา" : "โอนเข้า";
    } else if (type) {
      type = canonicalLedgerType(type) || type;
    }

    parsed.push({
      date: dateMs,
      description,
      amountIn,
      amountOut,
      type,
      createdBy,
      sourceRow: i + 1,
    });
  }

  const base = Date.now();
  return parsed.map((row, index) => ({
    ...row,
    createdAt: base + index,
  }));
}

export type ImportOwnerBookRow = {
  date: number;
  description: string;
  amountOut: number;
  type: string;
  note: string;
  createdBy: string;
  createdAt: number;
  sourceRow: number;
};

/** Parse owner books sheet: วันที่ | รายการ | ออก | type | … | note */
export function parseOwnerBooksWorkbook(
  data: ArrayBuffer | Uint8Array,
  createdBy: string,
): ImportOwnerBookRow[] {
  const workbook = XLSX.read(data, { type: "array", cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("ไม่พบชีทในไฟล์");

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    defval: null,
    raw: true,
  }) as unknown[][];

  const headerIndex = findHeaderIndex(rows);
  if (headerIndex < 0) {
    throw new Error("ไม่พบหัวตาราง วันที่ / รายการ");
  }

  const header = mapHeader(rows[headerIndex] || []);
  const colDate = header["วันที่"];
  const colDesc = header["รายการ"];
  const colOut = header["ออก"];
  const colType = header["type"] ?? header["Type"] ?? header["หมวด"] ?? header["ประเภท"];
  const colNote = header["note"] ?? header["Note"] ?? header["NOTE"] ?? header["หมายเหตุ"];

  if (colDate == null || colDesc == null || colOut == null) {
    throw new Error("คอลัมน์ไม่ครบ — ต้องมี วันที่, รายการ, ออก");
  }

  // บช. เจ้าของ.xlsx: category (sga/Asset/cogs) often unlabeled in column after ออก
  const typeColFallback = colType == null ? colOut + 1 : null;

  const parsed: Omit<ImportOwnerBookRow, "createdAt">[] = [];

  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const description = String(row[colDesc] ?? "").trim();
    if (!description) continue;

    const amountOut = toNumber(row[colOut]);
    if (amountOut <= 0) continue;

    const dateMs = cellToDateMs(row[colDate]);
    if (dateMs == null) {
      throw new Error(`แถว ${i + 1}: วันที่ไม่ถูกต้อง (${String(row[colDate])})`);
    }

    let type = "";
    if (colType != null) {
      type = String(row[colType] ?? "").trim();
    } else if (typeColFallback != null && typeColFallback !== colNote) {
      const raw = row[typeColFallback];
      if (typeof raw === "string") type = raw.trim();
    }
    if (type) type = canonicalLedgerType(type) || type;

    const note = colNote != null ? String(row[colNote] ?? "").trim() : "";

    parsed.push({
      date: dateMs,
      description,
      amountOut,
      type,
      note,
      createdBy,
      sourceRow: i + 1,
    });
  }

  const base = Date.now();
  return parsed.map((row, index) => ({
    ...row,
    createdAt: base + index,
  }));
}
