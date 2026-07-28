/**
 * Extract text from Gmail PDF attachments (GrabFood daily sales, etc.).
 * Uses pdfjs-dist (no native deps) — suitable for Cloud Functions.
 */
const MAX_PDF_BYTES = 8 * 1024 * 1024;
const MAX_PDF_TEXT = 120000;
const PDF_MARKER = "\n\n--- PDF ---\n";

function asString(v, max = 200) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

function decodeAttachmentData(data) {
  const s = String(data || "");
  try {
    return Buffer.from(s, "base64url");
  } catch {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(b64, "base64");
  }
}

/** Walk MIME tree → PDF parts with attachmentId */
function listPdfParts(payload, out = []) {
  if (!payload || typeof payload !== "object") return out;
  const filename = asString(payload.filename, 240);
  const mime = String(payload.mimeType || "").toLowerCase();
  const attId =
    payload.body && payload.body.attachmentId
      ? String(payload.body.attachmentId)
      : "";
  const size = Number(payload.body && payload.body.size) || 0;
  if (attId && (mime.includes("pdf") || /\.pdf$/i.test(filename))) {
    out.push({ filename: filename || "attachment.pdf", attachmentId: attId, size });
  }
  if (
    !attId &&
    payload.body &&
    payload.body.data &&
    (mime.includes("pdf") || /\.pdf$/i.test(filename))
  ) {
    out.push({
      filename: filename || "inline.pdf",
      attachmentId: "",
      size,
      inlineData: payload.body.data,
    });
  }
  const parts = Array.isArray(payload.parts) ? payload.parts : [];
  for (const p of parts) listPdfParts(p, out);
  return out;
}

async function fetchAttachmentBuffer(accessToken, messageId, attachmentId) {
  const url =
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/` +
    `${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error?.message || `attachment failed (${res.status})`);
  }
  const buf = decodeAttachmentData(json.data);
  if (buf.length > MAX_PDF_BYTES) {
    throw new Error(`PDF ใหญ่เกิน ${MAX_PDF_BYTES} bytes`);
  }
  return buf;
}

async function pdfBufferToText(buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    useSystemFonts: true,
    isEvalSupported: false,
  });
  const pdf = await loadingTask.promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const line = content.items
      .map((it) => (it && typeof it.str === "string" ? it.str : ""))
      .filter(Boolean)
      .join(" ");
    if (line.trim()) pages.push(line.trim());
  }
  return pages
    .join("\n")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_PDF_TEXT);
}

/**
 * Download first PDF attachment(s) and return concatenated text.
 * @returns {{ text: string, filenames: string[] }}
 */
async function extractPdfTextFromMessage(accessToken, messageId, payload) {
  const parts = listPdfParts(payload).slice(0, 2);
  if (!parts.length) {
    return { text: "", filenames: [], error: "ไม่พบไฟล์ PDF แนบ" };
  }
  const chunks = [];
  const filenames = [];
  const errors = [];
  for (const part of parts) {
    try {
      let buf;
      if (part.inlineData) {
        buf = decodeAttachmentData(part.inlineData);
        if (buf.length > MAX_PDF_BYTES) {
          errors.push(`${part.filename}: ไฟล์ใหญ่เกิน`);
          continue;
        }
      } else {
        buf = await fetchAttachmentBuffer(accessToken, messageId, part.attachmentId);
      }
      if (buf.slice(0, 5).toString() !== "%PDF-") {
        errors.push(`${part.filename}: ไม่ใช่ PDF`);
        continue;
      }
      const text = await pdfBufferToText(buf);
      if (text.length < 20) {
        errors.push(
          `${part.filename}: อ่านข้อความไม่ได้ (อาจเป็นรูปสแกนหรือมีรหัสผ่าน)`,
        );
        continue;
      }
      filenames.push(part.filename || "attachment.pdf");
      chunks.push(`# file: ${part.filename || "attachment.pdf"}\n${text}`);
    } catch (e) {
      const msg = e?.message || String(e);
      console.warn("vat-mail-pdf extract", part.filename, msg);
      errors.push(`${part.filename || "pdf"}: ${String(msg).slice(0, 120)}`);
    }
  }
  return {
    text: chunks.join("\n\n").slice(0, MAX_PDF_TEXT),
    filenames,
    error: chunks.length ? "" : errors[0] || "ดึงข้อความ PDF ไม่สำเร็จ",
  };
}

function mergeBodyWithPdf(rawText, pdfText, opts = {}) {
  const force = Boolean(opts.force);
  const bodyAll = String(rawText || "").trim();
  const pdf = String(pdfText || "").trim();
  if (!pdf) return bodyAll;
  const body = bodyAll.includes("--- PDF ---")
    ? bodyAll.split("--- PDF ---")[0].trim()
    : bodyAll;
  if (!force && bodyAll.includes("--- PDF ---")) return bodyAll;
  if (!body) return `--- PDF ---\n${pdf}`;
  return `${body}${PDF_MARKER}${pdf}`.slice(0, 200000);
}

function needsPdfEnrich(doc) {
  if (!doc || typeof doc !== "object") return false;
  const status = String(doc.parseStatus || "");
  if (status === "confirmed" || status === "ignored") return false;
  const channel = String(doc.channel || "");
  const subject = String(doc.subject || "").toLowerCase();
  const isGrab =
    channel === "grab" || /สรุปยอดขาย|grabfood|daily sales/.test(subject);
  if (!isGrab) return false;
  const raw = String(doc.rawText || "");
  // ยังไม่มีข้อความ PDF → ต้องดึง
  if (!raw.includes("--- PDF ---")) return true;
  // มี marker แต่สั้นมาก / fail ป้ายยอด → ลองดึงใหม่
  const pdfPart = raw.split("--- PDF ---")[1] || "";
  if (pdfPart.trim().length < 40) return true;
  if (status === "fail" && /PDF|ป้ายยอด|ยอดขาย|ลูกค้า/i.test(String(doc.parseError || ""))) {
    return true;
  }
  return false;
}

module.exports = {
  PDF_MARKER,
  listPdfParts,
  extractPdfTextFromMessage,
  mergeBodyWithPdf,
  needsPdfEnrich,
  pdfBufferToText,
};
