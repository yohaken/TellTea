/**
 * บันทึกศึกษาเมลสำหรับ AI — เก็บใน Firestore + โชว์ใน DOM (#vat-mail-study-notes)
 * คนอ่านไม่จำเป็น · AI อ่านจากหน้าเว็บหรือ meta ได้
 */
import { doc, getDoc, setDoc } from "firebase/firestore";
import { getDb } from "./firebase";
import { inferMailStudyHints } from "./vat-mail-study";
import type { PlatformEmailReport } from "./vat-sales-mail";

export const VAT_MAIL_STUDY_NOTES_DOC = "vatMailStudyNotes";

export type VatMailStudyNotes = {
  text: string;
  updatedAt: number;
  updatedBy: string;
  reportCount: number;
};

export function defaultVatMailStudyNotesText(): string {
  return [
    "VAT MAIL STUDY NOTES — สำหรับ AI",
    "อ่านจาก #vat-mail-study-notes บน /vat-sales/sources/",
    "",
    "โมเดลแหล่งยอดเดลิเวอรี่:",
    "- Grab: หลายไฟล์/เมลรายวัน → ม้วนเป็นยอดเดือน (ตัวเลขอาจอยู่ใน PDF แนบ)",
    "- LINE MAN: มีรายงานสรุปเดือน (PDF) + อาจมีรายวัน",
    "- Shopee: ไฟล์สรุปเดือน (Excel/รายงาน) · ใบกำกับ commission คนละชุด",
    "",
    "แท็กศึกษา: grab-รายวัน · lm-สรุปเดือน · sf-สรุปเดือน · excel · pdf · csv · รอแกะ · ข้าม",
    "ยังไม่ผสานเข้าตารางยอดเดลิเวอรี่จนกว่าจะจูนแล้ว",
    "",
    "— แคตตาล็อกเมล (กดอัปเดตบันทึกหลังซิงก์) —",
    "(ยังว่าง)",
  ].join("\n");
}

/** สร้างข้อความแคตตาล็อกจากแถวที่ซิงก์แล้ว (ไม่ใส่ raw body ทั้งฉบับ) */
export function buildMailStudyDump(
  reports: PlatformEmailReport[],
  opts?: { max?: number },
): string {
  const max = Math.min(200, Math.max(20, opts?.max || 80));
  const rows = [...reports]
    .sort((a, b) => (b.receivedAt || 0) - (a.receivedAt || 0))
    .slice(0, max);

  const lines: string[] = [
    "VAT MAIL STUDY NOTES — สำหรับ AI",
    "อ่านจาก #vat-mail-study-notes บน /vat-sales/sources/",
    `อัปเดตแคตตาล็อก: ${new Date().toISOString()} · ${rows.length} ฉบับ`,
    "",
    "โมเดล:",
    "- Grab = รายวันม้วนเดือน · LM/Shopee = สรุปเดือน (PDF/Excel ยาก)",
    "- แท็กศึกษาบนแถว · ยังไม่เข้างบ",
    "",
    "— แคตตาล็อก —",
  ];

  if (rows.length === 0) {
    lines.push("(ยังไม่มีเมลซิงก์ — เชื่อม Gmail แล้วกดซิงก์)");
    return lines.join("\n");
  }

  for (const r of rows) {
    const hints = inferMailStudyHints(r);
    const when = r.receivedAt
      ? new Date(r.receivedAt).toISOString().slice(0, 10)
      : "?";
    const files = (r.pdfFilenames || []).join("|") || "-";
    const tags = (r.studyTags || []).length
      ? (r.studyTags || []).join(",")
      : "-";
    const subj = String(r.subject || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    const from = String(r.from || "").replace(/\s+/g, " ").trim().slice(0, 60);
    lines.push(
      [
        when,
        r.channel,
        hints.grain,
        hints.fileKinds.join("/"),
        `tags=${tags}`,
        `files=${files}`,
        `from=${from}`,
        `subj=${subj}`,
      ].join(" · "),
    );
  }
  return lines.join("\n");
}

export async function loadVatMailStudyNotes(): Promise<VatMailStudyNotes> {
  const snap = await getDoc(doc(getDb(), "meta", VAT_MAIL_STUDY_NOTES_DOC));
  if (!snap.exists()) {
    return {
      text: defaultVatMailStudyNotesText(),
      updatedAt: 0,
      updatedBy: "",
      reportCount: 0,
    };
  }
  const raw = snap.data() || {};
  const text = String(raw.text || "").trim();
  return {
    text: text || defaultVatMailStudyNotesText(),
    updatedAt: Number(raw.updatedAt) || 0,
    updatedBy: String(raw.updatedBy || ""),
    reportCount: Number(raw.reportCount) || 0,
  };
}

export async function saveVatMailStudyNotes(
  text: string,
  actor: string,
  reportCount = 0,
): Promise<VatMailStudyNotes> {
  const next: VatMailStudyNotes = {
    text: String(text || "").trim() || defaultVatMailStudyNotesText(),
    updatedAt: Date.now(),
    updatedBy: actor || "owner",
    reportCount,
  };
  await setDoc(doc(getDb(), "meta", VAT_MAIL_STUDY_NOTES_DOC), next, {
    merge: true,
  });
  return next;
}

/** ดึงแถวปัจจุบัน → บันทึกแคตตาล็อกให้ AI */
export async function refreshVatMailStudyNotesFromReports(
  reports: PlatformEmailReport[],
  actor: string,
): Promise<VatMailStudyNotes> {
  const text = buildMailStudyDump(reports);
  return saveVatMailStudyNotes(text, actor, reports.length);
}
