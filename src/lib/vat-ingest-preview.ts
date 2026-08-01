/**
 * พรีวิวแหล่งนำเข้าเดลิเวอรี่ — จำแนกไฟล์/ข้อความ + สรุป 4 ช่อง
 * ไม่เขียน Firestore · ไม่ผสานเข้าตารางยอดเดลิเวอรี่
 */
import {
  isGrabStoresSummaryFileName,
  looksLikeGrabTransactionCsv,
  looksLikeGrabTransactionStoreFileName,
  parseGrabTransactionCsv,
} from "./vat-import-grab-csv";
import {
  looksLikeLinemanReportCsv,
  looksLikeLinemanReportCsvFileName,
  parseLinemanReportCsv,
} from "./vat-import-lineman-report-csv";
import {
  looksLikeLinemanMonthlyReport,
  parseLinemanMonthlyReport,
} from "./vat-import-lineman-monthly";
import {
  grabCsvToMonthSource,
  linemanMonthlyToMonthSource,
} from "./vat-month-sources";
import {
  looksLikeShopeeMonthlyMail,
  parseShopeeMonthlyMail,
} from "./vat-import-shopee-monthly-mail";
import type { MonthChannel } from "./vat-month-books";
import { normalizeMoney } from "./vat-sales";

export type IngestKind =
  | "grab-transaction-csv"
  | "grab-stores-summary-reject"
  | "lineman-report-csv"
  | "lineman-monthly-pdf-text"
  | "shopee-monthly-mail"
  | "unknown";

export type IngestPreviewAmounts = {
  sales: number;
  transfer: number;
  fee: number;
  gpVat: number;
};

export type IngestPreview = {
  kind: IngestKind;
  channel: MonthChannel | null;
  /** ป้ายสั้นว่าไฟล์/แหล่งนี้คืออะไร */
  identity: string;
  fileName: string;
  monthKey: string;
  amounts: IngestPreviewAmounts | null;
  dayCount: number;
  ok: boolean;
  warnings: string[];
  /** หัวตารางที่จับได้ (CSV) */
  headers: string[];
};

const EMPTY_AMOUNTS: IngestPreviewAmounts = {
  sales: 0,
  transfer: 0,
  fee: 0,
  gpVat: 0,
};

export const INGEST_KIND_LABEL: Record<IngestKind, string> = {
  "grab-transaction-csv": "Grab · Transaction_Store CSV",
  "grab-stores-summary-reject": "Grab · Transaction_Stores (ไม่ใช้)",
  "lineman-report-csv": "LINE MAN · REPORT_*.csv",
  "lineman-monthly-pdf-text": "LINE MAN · รายงานเดือน (ข้อความ/PDF)",
  "shopee-monthly-mail": "ShopeeFood · เมลสรุปเดือน",
  unknown: "ไม่รู้จักไฟล์",
};

export const INGEST_CHANNEL_HINT: Record<MonthChannel, string> = {
  grab: "ไฟล์ Transaction_Store_….csv (รายละเอียดรายการทั้งหมด) · ไม่ใช้ Transaction_Stores_",
  shopee: "วางข้อความบล็อก「รายงานยอดขายสะสมประจำเดือน」จากเมล · ไม่ต้องเปิดแนบ",
  lineman: "ไฟล์แนบ REPORT_*.csv จากเมล GP ประจำเดือน",
};

function base(
  partial: Partial<IngestPreview> & Pick<IngestPreview, "kind" | "identity">,
): IngestPreview {
  return {
    channel: null,
    fileName: "",
    monthKey: "",
    amounts: null,
    dayCount: 0,
    ok: false,
    warnings: [],
    headers: [],
    ...partial,
  };
}

/** จำแนกจากชื่อไฟล์ก่อน แล้วตามเนื้อหา */
export function identifyIngestSource(
  fileName: string,
  text: string,
): IngestKind {
  const name = String(fileName || "").trim();
  if (isGrabStoresSummaryFileName(name)) return "grab-stores-summary-reject";
  if (looksLikeGrabTransactionStoreFileName(name)) return "grab-transaction-csv";
  if (looksLikeLinemanReportCsvFileName(name)) return "lineman-report-csv";

  if (looksLikeShopeeMonthlyMail(text)) return "shopee-monthly-mail";
  if (looksLikeLinemanReportCsv(text)) return "lineman-report-csv";
  if (looksLikeGrabTransactionCsv(text)) return "grab-transaction-csv";
  if (looksLikeLinemanMonthlyReport(text)) return "lineman-monthly-pdf-text";
  return "unknown";
}

export function previewIngestText(
  text: string,
  opts?: { fileName?: string },
): IngestPreview {
  const fileName = String(opts?.fileName || "").trim();
  const kind = identifyIngestSource(fileName, text);

  if (kind === "grab-stores-summary-reject") {
    return base({
      kind,
      identity: INGEST_KIND_LABEL[kind],
      fileName,
      channel: "grab",
      warnings: [
        "ไฟล์ Transaction_Stores_ เป็นสรุปร้านสั้น — ต้องดาวน์โหลด「รายละเอียดรายการทั้งหมด」ได้ Transaction_Store_…",
      ],
    });
  }

  if (kind === "grab-transaction-csv") {
    if (!looksLikeGrabTransactionCsv(text)) {
      return base({
        kind,
        identity: INGEST_KIND_LABEL[kind],
        fileName,
        channel: "grab",
        warnings: ["ชื่อไฟล์คล้าย Grab แต่หัวตารางไม่ตรง Transaction CSV"],
      });
    }
    const parsed = parseGrabTransactionCsv(text);
    const src = grabCsvToMonthSource(parsed);
    return base({
      kind,
      identity: INGEST_KIND_LABEL[kind],
      fileName,
      channel: "grab",
      monthKey: parsed.monthKey,
      dayCount: parsed.days.length,
      headers: parsed.headers,
      amounts: {
        sales: src.sales,
        transfer: src.transfer,
        fee: src.fee,
        gpVat: src.gpVat,
      },
      ok: src.sales > 0 || src.transfer > 0,
      warnings: parsed.warnings,
    });
  }

  if (kind === "lineman-report-csv") {
    const parsed = parseLinemanReportCsv(text);
    return base({
      kind,
      identity: INGEST_KIND_LABEL[kind],
      fileName,
      channel: "lineman",
      monthKey: parsed.monthKey,
      dayCount: parsed.dayCount,
      headers: parsed.headers,
      amounts: {
        sales: parsed.sales,
        transfer: parsed.transfer,
        fee: parsed.feeInclVat,
        gpVat: parsed.gpVat,
      },
      ok: parsed.sales > 0 || parsed.transfer > 0,
      warnings: parsed.warnings,
    });
  }

  if (kind === "lineman-monthly-pdf-text") {
    const parsed = parseLinemanMonthlyReport(text);
    const src = linemanMonthlyToMonthSource(parsed);
    return base({
      kind,
      identity: INGEST_KIND_LABEL[kind],
      fileName,
      channel: "lineman",
      monthKey: parsed.monthKey,
      dayCount: parsed.days.length,
      amounts: {
        sales: src.sales,
        transfer: src.transfer,
        fee: src.fee,
        gpVat: src.gpVat,
      },
      ok: src.sales > 0 || src.transfer > 0,
      warnings: parsed.warnings,
    });
  }

  if (kind === "shopee-monthly-mail") {
    const parsed = parseShopeeMonthlyMail(text);
    return base({
      kind,
      identity: INGEST_KIND_LABEL[kind],
      fileName: fileName || "(ข้อความเมล)",
      channel: "shopee",
      monthKey: parsed.monthKey,
      amounts: {
        sales: parsed.sales,
        transfer: parsed.transfer,
        fee: parsed.fee,
        gpVat: parsed.gpVat,
      },
      ok: parsed.sales > 0 && parsed.transfer > 0,
      warnings: parsed.warnings,
    });
  }

  return base({
    kind: "unknown",
    identity: INGEST_KIND_LABEL.unknown,
    fileName,
    amounts: { ...EMPTY_AMOUNTS },
    warnings: [
      "จำแนกไม่ได้ — Grab ใช้ Transaction_Store_….csv · LM ใช้ REPORT_*.csv · Shopee วางบล็อกเมลสรุปเดือน",
    ],
  });
}

export function formatIngestMoney(n: number): string {
  return normalizeMoney(n).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
