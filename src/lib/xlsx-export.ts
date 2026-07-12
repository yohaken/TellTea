import * as XLSX from "xlsx";
import { labelLedgerType } from "./ledger-labels";
import type { LedgerEntry } from "./types";
import type { OwnerBookEntry } from "./owner-books";
import type { PnlReportData } from "./pnl";
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
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "บช.พนักงาน");
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
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "บช.เจ้าของ");
  downloadWorkbook(wb, `telltea-owner-books-${stamp()}.xlsx`);
}

export function exportPnlXlsx(report: PnlReportData) {
  const wb = XLSX.utils.book_new();

  const pnlRows = report.pnl.map((r) => ({
    เดือน: r.month,
    รายได้: r.income,
    COGS: r.cogs,
    กำไรขั้นต้น: r.gross,
    SGA: r.sga,
    EBITDA: r.ebitda,
    สุทธิ: r.net,
    Asset: r.asset,
    "เงินสด+": r.cashPlus,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pnlRows), "P&L");

  const staffRows = report.staff.map((r) => ({
    เดือน: r.month,
    asset: r.asset,
    cogs: r.cogs,
    sga: r.sga,
    other: r.other,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(staffRows), "แยก-พนักงาน");

  const ownerRows = report.owner.map((r) => ({
    เดือน: r.month,
    asset: r.asset,
    cogs: r.cogs,
    sga: r.sga,
    other: r.other,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ownerRows), "แยก-เจ้าของ");

  const combinedRows = report.combined.map((r) => ({
    เดือน: r.month,
    asset: r.asset,
    cogs: r.cogs,
    sga: r.sga,
    other: r.other,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(combinedRows), "รวม");

  downloadWorkbook(wb, `telltea-pnl-${stamp()}.xlsx`);
}
