/**
 * จัดช่องทางเมลเดลิเวอรี่ — From มาก่อน Subject
 * (กัน Shopee คำกว้างอย่าง "สรุปยอด"/"ยอดขาย" ไปจับ Grab/LINE MAN)
 */
import type { DeliveryChannel } from "./vat-sales";

export const MAIL_CHANNEL_ORDER: DeliveryChannel[] = [
  "grab",
  "lineman",
  "shopee",
];

export type MailChannelRuleLike = {
  enabled?: boolean;
  fromIncludes?: string[];
  subjectIncludes?: string[];
  subjectExcludes?: string[];
};

export type MailRulesLike = Partial<
  Record<DeliveryChannel, MailChannelRuleLike>
>;

/** เมลขยะ / ไม่ใช่ยอดขาย — ไม่ลงงบ · แท็กข้าม */
export function isNoiseMail(from: string, subject: string): boolean {
  const hay = `${from || ""} ${subject || ""}`.toLowerCase();
  return (
    /รีเซ็ตรหัส|ยืนยันอีเมล|password\s*reset|verify\s*(your\s*)?email|ยืนยันอีเมลของคุณ/.test(
      hay,
    ) ||
    /chargeback|kasikornsecurities|ksecurities|daily view/.test(hay) ||
    /account.?risk|ความเสี่ยง|ตกอยู่ในความเสี่ยง/.test(hay) ||
    /\botp\b|one[- ]time\s*password/.test(hay)
  );
}

export function isTaxInvoiceMail(subject: string): boolean {
  const s = String(subject || "").toLowerCase();
  return /tax\s*invoice|ใบกำกับภาษี|receipt\s*\/\s*tax|receipt\/tax|ใบเสร็จ/.test(
    s,
  );
}

const SHOPEE_SUBJECT_BLOCKLIST = new Set([
  "สรุปยอด",
  "ยอดขาย",
  "รายงานยอด",
  "รายงาน",
  "สรุป",
  "sales",
]);

function fromHits(from: string, rule?: MailChannelRuleLike): boolean {
  const f = String(from || "").toLowerCase();
  return (rule?.fromIncludes || []).some(
    (k) => k && f.includes(String(k).toLowerCase()),
  );
}

/** @returns grab | lineman | shopee | unknown */
export function matchMailChannel(
  from: string,
  subject: string,
  rules?: MailRulesLike,
): DeliveryChannel | "unknown" {
  const f = String(from || "").toLowerCase();
  const s = String(subject || "").toLowerCase();
  if (isNoiseMail(f, s)) return "unknown";

  for (const channel of MAIL_CHANNEL_ORDER) {
    const rule = rules?.[channel];
    if (rule && rule.enabled === false) continue;
    const excludes = rule?.subjectExcludes || [];
    if (excludes.some((k) => k && s.includes(String(k).toLowerCase()))) continue;
    if (isTaxInvoiceMail(s) && channel === "grab") continue;
    if (fromHits(f, rule)) return channel;
  }

  if (/@?grab\.com\b|grabfood/.test(f) && !isTaxInvoiceMail(s)) return "grab";
  if (/@?lmwn\.com\b|\blmwn\b|lineman|wongnai/.test(f)) return "lineman";
  if (/shopeefood|@shopee\./.test(f)) return "shopee";

  if (/grabfood|สรุปยอดขายสำหรับคำสั่งซื้อ|daily sales report/.test(s)) {
    return "grab";
  }
  if (
    /line\s*man|lineman|wongnai|รายงานยอดขายรายวัน|รายงานยอดโอนออก/.test(s)
  ) {
    return "lineman";
  }
  if (/shopeefood|รายงานการโอนเงินสำหรับ\s*shopee/.test(s)) {
    return "shopee";
  }

  return "unknown";
}

/** ตัดคำ subject กว้างออกจากกฎ Shopee ที่เซฟไว้ผิด */
export function sanitizeShopeeSubjectIncludes(
  subjects: string[],
  fallback: string[],
): string[] {
  const next = subjects.filter(
    (t) => !SHOPEE_SUBJECT_BLOCKLIST.has(String(t).trim().toLowerCase()),
  );
  return next.length ? next : [...fallback];
}
