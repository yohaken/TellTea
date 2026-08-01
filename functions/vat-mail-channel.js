/**
 * จัดช่องทางเมลเดลิเวอรี่ — From มาก่อน Subject
 * (กัน Shopee คำกว้างอย่าง "สรุปยอด"/"ยอดขาย" ไปจับ Grab/LINE MAN)
 */

const CHANNELS = ["grab", "lineman", "shopee"];

/** เมลขยะ / ไม่ใช่ยอดขาย — ไม่ลงงบ · แท็กข้าม */
function isNoiseMail(from, subject) {
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

/** ใบกำกับรายออเดอร์ Grab ฯลฯ — ไม่ใช่สรุปยอดวัน */
function isTaxInvoiceMail(subject) {
  const s = String(subject || "").toLowerCase();
  return /tax\s*invoice|ใบกำกับภาษี|receipt\s*\/\s*tax|receipt\/tax|ใบเสร็จ/.test(
    s,
  );
}

function fromHitsChannel(from, rule) {
  const f = String(from || "").toLowerCase();
  return (rule.fromIncludes || []).some((k) => k && f.includes(String(k).toLowerCase()));
}

/**
 * @returns {"grab"|"lineman"|"shopee"|"unknown"}
 */
function matchChannel(from, subject, rules) {
  const f = String(from || "").toLowerCase();
  const s = String(subject || "").toLowerCase();
  if (isNoiseMail(f, s)) return "unknown";

  // 1) From domain / display-name — authoritative
  for (const channel of CHANNELS) {
    const rule = rules && rules[channel];
    if (!rule || rule.enabled === false) continue;
    const excludes = rule.subjectExcludes || [];
    if (excludes.some((k) => k && s.includes(String(k).toLowerCase()))) continue;
    if (isTaxInvoiceMail(s) && channel === "grab") continue;
    if (fromHitsChannel(f, rule)) return channel;
  }

  // Hardcoded from fallbacks (แม้กฎใน settings ถูกล้าง)
  if (/@?grab\.com\b|grabfood/.test(f) && !isTaxInvoiceMail(s)) return "grab";
  if (/@?lmwn\.com\b|\blmwn\b|lineman|wongnai/.test(f)) return "lineman";
  if (/shopeefood|@shopee\.|shopee\.co\.th/.test(f)) return "shopee";

  // 2) Subject เฉพาะช่อง — ไม่ใช้คำกว้าง "ยอดขาย"/"สรุปยอด" เปล่าๆ
  if (/grabfood|สรุปยอดขายสำหรับคำสั่งซื้อ|daily sales report/.test(s)) {
    return "grab";
  }
  if (
    /line\s*man|lineman|wongnai|รายงานยอดขายรายวัน|รายงานยอดโอนออก/.test(s)
  ) {
    return "lineman";
  }
  if (
    /shopeefood|shopee\s*food|รายงานการโอนเงินสำหรับ\s*shopee|ใบแจ้งยอด.*shopee|shopee.*settlement|ค่าคอมมิชชั่น.*shopee/.test(
      s,
    )
  ) {
    return "shopee";
  }

  return "unknown";
}

/** คำ subject กว้างที่ทำให้ Shopee จับผิดช่อง — ตัดออกจากกฎที่เซฟไว้ */
const SHOPEE_SUBJECT_BLOCKLIST = new Set([
  "สรุปยอด",
  "ยอดขาย",
  "รายงานยอด",
  "รายงาน",
  "สรุป",
  "sales",
]);

function sanitizeChannelRule(channel, rule, fallback) {
  const base = rule && typeof rule === "object" ? rule : {};
  const fb = fallback || {};
  let subjectIncludes = Array.isArray(base.subjectIncludes) && base.subjectIncludes.length
    ? base.subjectIncludes.map((x) => String(x).trim()).filter(Boolean)
    : [...(fb.subjectIncludes || [])];
  if (channel === "shopee") {
    subjectIncludes = subjectIncludes.filter(
      (t) => !SHOPEE_SUBJECT_BLOCKLIST.has(t.toLowerCase()),
    );
    if (!subjectIncludes.length) {
      subjectIncludes = [...(fb.subjectIncludes || [])];
    }
  }
  return {
    enabled: base.enabled !== false,
    fromIncludes:
      Array.isArray(base.fromIncludes) && base.fromIncludes.length
        ? base.fromIncludes.map((x) => String(x).trim().toLowerCase()).filter(Boolean)
        : [...(fb.fromIncludes || [])],
    subjectIncludes: subjectIncludes.map((x) => String(x).trim().toLowerCase()),
    subjectExcludes:
      Array.isArray(base.subjectExcludes) && base.subjectExcludes.length
        ? base.subjectExcludes.map((x) => String(x).trim().toLowerCase()).filter(Boolean)
        : [...(fb.subjectExcludes || [])],
  };
}

module.exports = {
  CHANNELS,
  isNoiseMail,
  isTaxInvoiceMail,
  matchChannel,
  sanitizeChannelRule,
  SHOPEE_SUBJECT_BLOCKLIST,
};
