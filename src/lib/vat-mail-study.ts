/**
 * ศึกษาเมลสำหรับยอดเดลิเวอรี่ — แท็ก + เดาช่วง/ชนิดไฟล์ (pure)
 * รายวัน vs สรุปเดือน · excel / pdf / csv
 * เฟส D2: แท็กอย่างเดียว — ยังไม่แกะยอดลงงบ
 */
import {
  isNoiseMail,
  isTaxInvoiceMail,
  matchMailChannel,
  type MailRulesLike,
} from "./vat-mail-channel";
import type { DeliveryChannel } from "./vat-sales";

/** แท็กศึกษาแนะนำ — จูนร่วม AI · ยังไม่เข้างบ */
export const MAIL_STUDY_TAG_PRESETS = [
  "grab-รายวัน",
  "lm-สรุปเดือน",
  "lm-รายวัน-ขาย",
  "lm-รายวัน-โอน",
  "sf-สรุปเดือน",
  "sf-โอนรายวัน",
  "excel",
  "pdf",
  "csv",
  "รอแกะ",
  "ข้าม",
] as const;

export type MailStudyTag = (typeof MAIL_STUDY_TAG_PRESETS)[number];

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
  if (/สรุปเดือน|ประจำเดือน|monthly|ทั้งเดือน|end of month/.test(blob)) {
    grain = "monthly";
  } else if (/รายสัปดาห์|weekly/.test(blob)) {
    grain = "weekly";
  } else if (grain === "unknown" && /รายวัน|daily|ทุกวัน|โอนเงิน|ยอดโอนออก/.test(blob)) {
    grain = "daily";
  }
  return {
    grain,
    fileKinds: fileKinds.size ? [...fileKinds] : ["unknown"],
  };
}

const TYPE_TAGS = new Set<string>([
  "grab-รายวัน",
  "lm-สรุปเดือน",
  "lm-รายวัน-ขาย",
  "lm-รายวัน-โอน",
  "sf-สรุปเดือน",
  "sf-โอนรายวัน",
  "ข้าม",
]);

/**
 * เสนอแท็กศึกษาจาก From/Subject/ไฟล์ — รวมกับแท็กที่มี (ไม่ลบของคน)
 * ไม่แตะยอดเงิน / ไม่เข้างบ
 */
export function inferMailStudyTags(
  report: {
    from?: string;
    subject: string;
    snippet?: string;
    channel?: string;
    reportKind?: string;
    pdfFilenames?: string[];
    studyTags?: string[];
  },
  rules?: MailRulesLike,
): string[] {
  const from = String(report.from || "");
  const subject = String(report.subject || "");
  const existing = (report.studyTags || [])
    .map((t) => String(t).trim())
    .filter(Boolean);
  const tags = new Set(existing);

  if (isNoiseMail(from, subject) || isTaxInvoiceMail(subject)) {
    tags.add("ข้าม");
    tags.delete("รอแกะ");
    return [...tags].slice(0, 20);
  }

  const inferred = matchMailChannel(from, subject, rules);
  const channel: DeliveryChannel | "unknown" =
    inferred !== "unknown"
      ? inferred
      : report.channel === "shopee" ||
          report.channel === "grab" ||
          report.channel === "lineman"
        ? report.channel
        : "unknown";

  const hints = inferMailStudyHints(report);
  for (const k of hints.fileKinds) {
    if (k !== "unknown") tags.add(k);
  }

  const sub = subject.toLowerCase();
  let typed = false;

  if (channel === "grab") {
    tags.add("grab-รายวัน");
    typed = true;
  } else if (channel === "lineman") {
    if (hints.grain === "monthly" || /สรุปเดือน|ประจำเดือน|monthly/.test(sub)) {
      tags.add("lm-สรุปเดือน");
      typed = true;
    } else if (/ยอดโอนออก|โอนออก/.test(sub)) {
      tags.add("lm-รายวัน-โอน");
      typed = true;
    } else if (/ยอดขายรายวัน|รายรับ|รายงานยอดขาย/.test(sub)) {
      tags.add("lm-รายวัน-ขาย");
      typed = true;
    } else {
      tags.add("lm-รายวัน-ขาย");
      typed = true;
    }
  } else if (channel === "shopee") {
    if (hints.grain === "monthly" || /สรุปเดือน|ประจำเดือน|monthly/.test(sub)) {
      tags.add("sf-สรุปเดือน");
      typed = true;
    } else if (/โอนเงิน|settlement|รายงานการโอน/.test(sub)) {
      tags.add("sf-โอนรายวัน");
      typed = true;
    } else {
      tags.add("รอแกะ");
    }
  } else {
    tags.add("รอแกะ");
  }

  const hasType = [...tags].some((t) => TYPE_TAGS.has(t));
  if (typed && hasType) tags.delete("รอแกะ");

  return [...tags].slice(0, 20);
}

/** รวมแท็กเดิมกับที่เสนอ — true ถ้ามีการเปลี่ยนแปลง */
export function mergeStudyTags(
  current: string[] | undefined,
  inferred: string[],
): { next: string[]; changed: boolean } {
  const cur = (current || []).map((t) => String(t).trim()).filter(Boolean);
  const next = [...new Set([...cur, ...inferred])].slice(0, 20);
  const changed =
    next.length !== cur.length || next.some((t, i) => t !== cur[i]);
  return { next, changed };
}
