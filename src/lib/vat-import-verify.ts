/**
 * ตรวจแถวนำเข้า — heuristic กันใส่ผิดช่อง / คิดล่วงหน้า
 * ไม่บังคับบล็อก · เป็นคำเตือนให้คน/AI ทบทวน
 */
import type { VatImportRow } from "./vat-import";

export type VerifyIssue = {
  rowId: string;
  dateKey: string;
  channel: string;
  code: string;
  level: "warn" | "info";
  message: string;
};

export type VerifyReport = {
  issues: VerifyIssue[];
  warnCount: number;
  /** สรุปสั้นสำหรับ AI */
  summary: string;
};

function push(
  out: VerifyIssue[],
  row: VatImportRow,
  code: string,
  level: VerifyIssue["level"],
  message: string,
) {
  out.push({
    rowId: row.id,
    dateKey: row.dateKey,
    channel: row.channel,
    code,
    level,
    message,
  });
}

/** ตรวจชุดแถวในเดือน */
export function verifyVatImportRows(rows: VatImportRow[]): VerifyReport {
  const issues: VerifyIssue[] = [];
  for (const r of rows) {
    if (r.status === "skipped") continue;
    if (r.channel === "storefront") continue;

    const g = r.grossInclusive;
    const fee = r.fee;
    const net = r.netTransfer;
    const vat = r.gpVat;

    if (fee > 0 && g > 0 && fee > g + 0.01) {
      push(issues, r, "fee-gt-gross", "warn", "คชจ. > ยอดขาย — อาจสลับช่อง");
    }
    if (net > 0 && g > 0 && net > g + 0.01) {
      push(issues, r, "net-gt-gross", "warn", "ยอดโอน > ยอดขาย — ตรวจช่อง");
    }
    if (vat > 0 && fee > 0 && vat > fee + 0.01) {
      push(issues, r, "gpvat-gt-fee", "warn", "GP≠ > คชจ. — มักผิดช่อง");
    }
    if (vat > 0 && fee <= 0 && g <= 0 && net <= 0) {
      // ใบกำกับอย่างเดียว โอเค
    } else if (vat > 0 && g > 0 && fee <= 0) {
      push(
        issues,
        r,
        "vat-without-fee",
        "info",
        "มี GP≠ แต่ไม่มีคชจ. — ตรวจว่ามาจากใบกำกับ",
      );
    }
    if (g > 0 && fee <= 0 && net <= 0 && (r.channel === "grab" || r.channel === "lineman")) {
      push(
        issues,
        r,
        "sales-only-delivery",
        "info",
        "มียอดขายเดลิเวอรี่แต่ไม่มีคชจ./โอน — อาจยังไม่ครบ",
      );
    }
    if (g > 0 && net > 0 && fee <= 0) {
      const implied = Math.round((g - net) * 100) / 100;
      if (implied > 0.05) {
        push(
          issues,
          r,
          "implied-fee",
          "info",
          `คชจ.ว่าง แต่ขาย−โอน≈${implied} — ตรวจว่าไม่ได้ลืมคชจ.`,
        );
      }
    }
    if (vat > 0 && !String(r.invoiceNo || "").trim()) {
      push(
        issues,
        r,
        "vat-no-invoice",
        "info",
        "มี GP≠ แต่ไม่มีเลขที่ใบกำกับ",
      );
    }
  }

  const warnCount = issues.filter((i) => i.level === "warn").length;
  const summary =
    issues.length === 0
      ? "ตรวจเบื้องต้น: ไม่พบสัญญาณผิดช่อง"
      : `ตรวจเบื้องต้น: เตือน ${warnCount} · หมายเหตุ ${issues.length - warnCount} — ทบทวนก่อนปิดเดือน`;

  return { issues, warnCount, summary };
}

/** ข้อความสั้นฝังโน้ต AI — แนวคิด verify */
export const VAT_IMPORT_VERIFY_NOTES: string[] = [
  "กวาด verify: คชจ.>ขาย · โอน>ขาย · GP≠>คชจ.",
  "มีเตือน → อย่าเดา · เปิดแหล่งจริงหรือถามโต๊ะจูน",
];
