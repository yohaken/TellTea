import * as XLSX from "xlsx";
import { labelLedgerType } from "./ledger-labels";
import { categoryLabel } from "./categories";
import type { LedgerEntry } from "./types";
import type { OwnerBookEntry } from "./owner-books";
import {
  averageCategoryRows,
  sumCategoryRows,
  averagePnlRows,
  summarizePnlRows,
  type MonthCategoryRow,
  type PnlMonthRow,
  type PnlReportData,
} from "./pnl";
import { formatDateShort, formatDateTimeShort, entryUpdatedAt } from "./utils";

function downloadWorkbook(wb: XLSX.WorkBook, filename: string) {
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function stamp() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function appendSheet(
  wb: XLSX.WorkBook,
  name: string,
  rows: Record<string, string | number>[],
) {
  const safe = name.slice(0, 31);
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(rows.length ? rows : [{ หมายเหตุ: "ไม่มีข้อมูล" }]),
    safe,
  );
}

function categorySheetRows(rows: MonthCategoryRow[], includeTotals: boolean) {
  const colAsset = categoryLabel("asset");
  const colCogs = categoryLabel("cogs");
  const colSga = categoryLabel("sga");
  const colOther = categoryLabel("other");
  const out = rows.map((r) => ({
    เดือน: r.month,
    [colAsset]: r.asset,
    [colCogs]: r.cogs,
    [colSga]: r.sga,
    [colOther]: r.other,
  }));
  if (includeTotals && rows.length) {
    const t = sumCategoryRows(rows);
    const a = averageCategoryRows(rows);
    out.push({
      เดือน: "รวม",
      [colAsset]: t.asset,
      [colCogs]: t.cogs,
      [colSga]: t.sga,
      [colOther]: t.other,
    });
    if (a) {
      out.push({
        เดือน: "เฉลี่ย",
        [colAsset]: a.asset,
        [colCogs]: a.cogs,
        [colSga]: a.sga,
        [colOther]: a.other,
      });
    }
  }
  return out;
}

function pctCell(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "";
  return Number((n * 100).toFixed(2));
}

function pnlSheetRows(rows: PnlMonthRow[], includeTotals: boolean) {
  const colCogs = categoryLabel("cogs");
  const colSga = categoryLabel("sga");
  const colAsset = categoryLabel("asset");
  const mapRow = (r: PnlMonthRow) => ({
    เดือน: r.month,
    รายได้: r.income,
    "รายได้/วัน": Number(r.incomePerDay.toFixed(2)),
    [colCogs]: r.cogs,
    [`${colCogs}%`]: pctCell(r.cogsPct),
    กำไรขั้นต้น: r.gross,
    "กำไรขั้นต้น%": pctCell(r.grossPct),
    [colSga]: r.sga,
    [`${colSga}%`]: pctCell(r.sgaPct),
    สุทธิ: r.net,
    "สุทธิ%": pctCell(r.netPct),
    [colAsset]: r.asset,
    "invest/net%": pctCell(r.investOverNet),
    "เงินสด+": r.cashPlus,
    "เงินสดต่อรายได้%": pctCell(r.cashOverIncome),
  });
  const out = rows.map(mapRow);
  if (includeTotals) {
    const t = summarizePnlRows(rows);
    const a = averagePnlRows(rows);
    if (t) out.push(mapRow(t));
    if (a) out.push(mapRow(a));
  }
  return out;
}

export function exportLedgerXlsx(entries: LedgerEntry[]) {
  const rows = entries.map((e) => ({
    วันที่: formatDateShort(e.date),
    รายการ: e.description,
    เข้า: e.amountIn || "",
    ออก: e.amountOut || "",
    ประเภท: e.type ? labelLedgerType(e.type) : "",
    แก้ไขล่าสุด: formatDateTimeShort(entryUpdatedAt(e)),
    สร้างโดย: e.createdBy || "",
  }));
  const wb = XLSX.utils.book_new();
  appendSheet(wb, "บช.พนักงาน", rows);
  downloadWorkbook(wb, `telltea-ledger-${stamp()}.xlsx`);
}

export function exportOwnerBooksXlsx(entries: OwnerBookEntry[]) {
  const rows = entries.map((e) => ({
    วันที่: formatDateShort(e.date),
    รายการ: e.description,
    ออก: e.amountOut || "",
    ประเภท: e.type ? labelLedgerType(e.type) : e.type || "",
    note: e.note || "",
    แก้ไขล่าสุด: formatDateTimeShort(entryUpdatedAt(e)),
    สร้างโดย: e.createdBy || "",
  }));
  const wb = XLSX.utils.book_new();
  appendSheet(wb, "บช.เจ้าของ", rows);
  downloadWorkbook(wb, `telltea-owner-books-${stamp()}.xlsx`);
}

export type ExportPnlOptions = {
  summaryMode?: boolean;
  includeTotals?: boolean;
};

/** ไฟล์เดียว · แยกแผ่นงานตามตาราง PNL ทั้งหมด */
export function exportPnlXlsx(report: PnlReportData, options: ExportPnlOptions = {}) {
  const includeTotals = options.includeTotals ?? false;
  const wb = XLSX.utils.book_new();

  appendSheet(wb, "1-บช.พนักงาน", categorySheetRows(report.staff, includeTotals));
  appendSheet(wb, "1-บช.เจ้าของ", categorySheetRows(report.owner, includeTotals));
  appendSheet(wb, "2-รวม", categorySheetRows(report.combined, includeTotals));
  appendSheet(wb, "3-กำไรขาดทุน", pnlSheetRows(report.pnl, includeTotals));

  const modeTag = options.summaryMode ? "summary" : "all";
  downloadWorkbook(wb, `telltea-pnl-${modeTag}-${stamp()}.xlsx`);
}

export type CombinedExportInput = {
  ledger?: LedgerEntry[];
  ownerBooks?: OwnerBookEntry[];
  pnl?: PnlReportData;
};

/** ส่งออกทุกอย่างที่เลือกเป็นไฟล์เดียว แยกแผ่นงาน */
export function exportCombinedTablesXlsx(input: CombinedExportInput) {
  const wb = XLSX.utils.book_new();
  let sheets = 0;

  if (input.ledger) {
    appendSheet(
      wb,
      "บช.พนักงาน",
      input.ledger.map((e) => ({
        วันที่: formatDateShort(e.date),
        รายการ: e.description,
        เข้า: e.amountIn || "",
        ออก: e.amountOut || "",
        ประเภท: e.type ? labelLedgerType(e.type) : "",
        แก้ไขล่าสุด: formatDateTimeShort(entryUpdatedAt(e)),
        สร้างโดย: e.createdBy || "",
      })),
    );
    sheets += 1;
  }

  if (input.ownerBooks) {
    appendSheet(
      wb,
      "บช.เจ้าของ",
      input.ownerBooks.map((e) => ({
        วันที่: formatDateShort(e.date),
        รายการ: e.description,
        ออก: e.amountOut || "",
        ประเภท: e.type ? labelLedgerType(e.type) : e.type || "",
        note: e.note || "",
        แก้ไขล่าสุด: formatDateTimeShort(entryUpdatedAt(e)),
        สร้างโดย: e.createdBy || "",
      })),
    );
    sheets += 1;
  }

  if (input.pnl) {
    const report = input.pnl;
    appendSheet(wb, "PNL-พนักงาน", categorySheetRows(report.staff, true));
    appendSheet(wb, "PNL-เจ้าของ", categorySheetRows(report.owner, true));
    appendSheet(wb, "PNL-รวม", categorySheetRows(report.combined, true));
    appendSheet(wb, "PNL-กำไรขาดทุน", pnlSheetRows(report.pnl, true));
    sheets += 4;
  }

  if (!sheets) throw new Error("ไม่มีข้อมูลให้ส่งออก");
  downloadWorkbook(wb, `telltea-export-${stamp()}.xlsx`);
}
