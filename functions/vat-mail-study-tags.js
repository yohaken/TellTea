/**
 * แท็กศึกษาเมล (D2) — mirror ของ src/lib/vat-mail-study.ts
 * ยังไม่แกะยอดลงงบ
 */
const {
  isNoiseMail,
  isTaxInvoiceMail,
  matchChannel,
} = require("./vat-mail-channel");

function inferFileKinds(subject, pdfFilenames) {
  const names = (pdfFilenames || []).map((n) => String(n).toLowerCase());
  const blob = `${subject || ""} ${names.join(" ")}`.toLowerCase();
  const kinds = new Set();
  for (const n of names) {
    if (/\.pdf($|\b)/.test(n) || n.includes("pdf")) kinds.add("pdf");
    if (/\.(xlsx?|xls)($|\b)/.test(n) || n.includes("excel")) kinds.add("excel");
    if (/\.csv($|\b)/.test(n)) kinds.add("csv");
  }
  if (!kinds.size) {
    if (blob.includes(".pdf") || /\bpdf\b/.test(blob)) kinds.add("pdf");
    if (blob.includes(".xlsx") || blob.includes(".xls") || blob.includes("excel")) {
      kinds.add("excel");
    }
    if (blob.includes(".csv") || /\bcsv\b/.test(blob)) kinds.add("csv");
  }
  return [...kinds];
}

function isMonthly(subject) {
  return /สรุปเดือน|ประจำเดือน|monthly|ทั้งเดือน|end of month/i.test(
    String(subject || ""),
  );
}

function inferMailStudyTags(report, rules) {
  const from = String(report.from || "");
  const subject = String(report.subject || "");
  const existing = Array.isArray(report.studyTags)
    ? report.studyTags.map((t) => String(t).trim()).filter(Boolean)
    : [];
  const tags = new Set(existing);

  if (isNoiseMail(from, subject) || isTaxInvoiceMail(subject)) {
    tags.add("ข้าม");
    tags.delete("รอแกะ");
    return [...tags].slice(0, 20);
  }

  const inferred = matchChannel(from, subject, rules);
  const channel =
    inferred !== "unknown"
      ? inferred
      : ["shopee", "grab", "lineman"].includes(report.channel)
        ? report.channel
        : "unknown";

  for (const k of inferFileKinds(subject, report.pdfFilenames)) {
    tags.add(k);
  }

  const sub = subject.toLowerCase();
  let typed = false;

  if (channel === "grab") {
    tags.add("grab-รายวัน");
    typed = true;
  } else if (channel === "lineman") {
    if (isMonthly(subject)) {
      tags.add("lm-สรุปเดือน");
      typed = true;
    } else if (/ยอดโอนออก|โอนออก/.test(sub)) {
      tags.add("lm-รายวัน-โอน");
      typed = true;
    } else {
      tags.add("lm-รายวัน-ขาย");
      typed = true;
    }
  } else if (channel === "shopee") {
    if (isMonthly(subject)) {
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

  if (typed) tags.delete("รอแกะ");
  return [...tags].slice(0, 20);
}

function tagsChanged(current, next) {
  const cur = Array.isArray(current)
    ? current.map((t) => String(t).trim()).filter(Boolean)
    : [];
  if (cur.length !== next.length) return true;
  return next.some((t, i) => t !== cur[i]);
}

module.exports = {
  inferMailStudyTags,
  tagsChanged,
};
