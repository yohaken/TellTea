/**
 * ศึกษาเมลสำหรับยอดเดลิเวอรี่ — แท็ก + เดาช่วง/ชนิดไฟล์ (pure)
 * รายวัน vs สรุปเดือน · excel / pdf / csv
 */

/** แท็กศึกษาแนะนำ — จูนร่วม AI · ยังไม่เข้างบ */
export const MAIL_STUDY_TAG_PRESETS = [
  "grab-รายวัน",
  "lm-สรุปเดือน",
  "sf-สรุปเดือน",
  "excel",
  "pdf",
  "csv",
  "รอแกะ",
  "ข้าม",
] as const;

export type MailStudyFileKind = "pdf" | "excel" | "csv" | "unknown";

/** เดาชนิดไฟล์/ช่วงจากชื่อไฟล์ + หัวข้อ — ช่วยศึกษา ไม่บังคับงบ */
export function inferMailStudyHints(report: {
  subject: string;
  snippet?: string;
  reportKind?: string;
  pdfFilenames?: string[];
}): {
  grain: "daily" | "weekly" | "monthly" | "unknown";
  fileKinds: MailStudyFileKind[];
} {
  const names = (report.pdfFilenames || []).map((n) => n.toLowerCase());
  const blob = `${report.subject || ""} ${report.snippet || ""} ${names.join(" ")}`.toLowerCase();
  const fileKinds = new Set<MailStudyFileKind>();
  for (const n of names) {
    if (/\.pdf($|\b)/.test(n) || n.includes("pdf")) fileKinds.add("pdf");
    if (/\.(xlsx?|xls)($|\b)/.test(n) || n.includes("excel")) fileKinds.add("excel");
    if (/\.csv($|\b)/.test(n)) fileKinds.add("csv");
  }
  if (!fileKinds.size) {
    if (blob.includes(".pdf") || /\bpdf\b/.test(blob)) fileKinds.add("pdf");
    if (blob.includes(".xlsx") || blob.includes(".xls") || blob.includes("excel")) {
      fileKinds.add("excel");
    }
    if (blob.includes(".csv") || /\bcsv\b/.test(blob)) fileKinds.add("csv");
  }
  let grain: "daily" | "weekly" | "monthly" | "unknown" =
    report.reportKind === "weekly" ||
    report.reportKind === "monthly" ||
    report.reportKind === "daily"
      ? report.reportKind
      : "unknown";
  if (
    /สรุปเดือน|ประจำเดือน|monthly|ทั้งเดือน|end of month/.test(blob)
  ) {
    grain = "monthly";
  } else if (/รายสัปดาห์|weekly/.test(blob)) {
    grain = "weekly";
  } else if (grain === "unknown" && /รายวัน|daily|ทุกวัน/.test(blob)) {
    grain = "daily";
  }
  return {
    grain,
    fileKinds: fileKinds.size ? [...fileKinds] : ["unknown"],
  };
}
