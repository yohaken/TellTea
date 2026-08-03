/**
 * VAT mail PDFs — download Gmail attachments, store in Firebase Storage,
 * extract text for amount parse.
 *
 * Storage path: vat-mail-pdfs/{yyyy}/{messageId}/{filename}.pdf
 * Admin upload (bypass Storage rules) · owner opens via signed URL callable.
 */
const crypto = require("crypto");
const { resolveStorageBucket } = require("./storage-bucket");

const MAX_PDF_BYTES = 8 * 1024 * 1024;
const MAX_PDF_TEXT = 120000;
const PDF_MARKER = "\n\n--- PDF ---\n";

function asString(v, max = 200) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

function safeFilename(raw) {
  const base = String(raw || "attachment.pdf")
    .replace(/[^a-zA-Z0-9._\-\u0E00-\u0E7F]+/g, "_")
    .slice(0, 80);
  return /\.pdf$/i.test(base) ? base : `${base || "attachment"}.pdf`;
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

function isPdfPart(filename, mime) {
  return mime.includes("pdf") || /\.pdf$/i.test(filename);
}

/** MIME / ชื่อไฟล์ที่อัปขึ้น Drive ได้ (PDF · Excel · CSV) */
function matchDriveableKind(filename, mime) {
  const name = String(filename || "");
  const m = String(mime || "").toLowerCase();
  if (isPdfPart(name, m)) {
    return { kind: "pdf", mimeType: "application/pdf", filename: name || "attachment.pdf" };
  }
  if (
    m.includes("spreadsheetml") ||
    m.includes("excel") ||
    /\.xlsx$/i.test(name)
  ) {
    return {
      kind: "xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename: name || "attachment.xlsx",
    };
  }
  if (m === "application/vnd.ms-excel" || /\.xls$/i.test(name)) {
    return {
      kind: "xls",
      mimeType: "application/vnd.ms-excel",
      filename: name || "attachment.xls",
    };
  }
  if (m.includes("csv") || /\.csv$/i.test(name)) {
    return { kind: "csv", mimeType: "text/csv", filename: name || "attachment.csv" };
  }
  return null;
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
  if (attId && isPdfPart(filename, mime)) {
    out.push({ filename: filename || "attachment.pdf", attachmentId: attId, size });
  }
  if (
    !attId &&
    payload.body &&
    payload.body.data &&
    isPdfPart(filename, mime)
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

/** Walk MIME tree → PDF / Excel / CSV for Drive upload */
function listDriveableParts(payload, out = []) {
  if (!payload || typeof payload !== "object") return out;
  const filename = asString(payload.filename, 240);
  const mime = String(payload.mimeType || "").toLowerCase();
  const attId =
    payload.body && payload.body.attachmentId
      ? String(payload.body.attachmentId)
      : "";
  const size = Number(payload.body && payload.body.size) || 0;
  const kind = matchDriveableKind(filename, mime);
  if (kind && attId) {
    out.push({
      filename: kind.filename,
      attachmentId: attId,
      size,
      mimeType: kind.mimeType,
      kind: kind.kind,
    });
  }
  if (
    kind &&
    !attId &&
    payload.body &&
    payload.body.data
  ) {
    out.push({
      filename: kind.filename,
      attachmentId: "",
      size,
      mimeType: kind.mimeType,
      kind: kind.kind,
      inlineData: payload.body.data,
    });
  }
  const parts = Array.isArray(payload.parts) ? payload.parts : [];
  for (const p of parts) listDriveableParts(p, out);
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

/** Save PDF bytes to Storage · returns object path */
async function storeMailPdfBuffer(buffer, opts) {
  const messageId = asString(opts.messageId, 80) || crypto.randomBytes(8).toString("hex");
  const year = String(opts.year || new Date().getFullYear());
  const filename = safeFilename(opts.filename);
  const objectPath = `vat-mail-pdfs/${year}/${messageId}/${filename}`;
  const bucket = await resolveStorageBucket();
  const file = bucket.file(objectPath);
  const token = crypto.randomUUID();
  await file.save(buffer, {
    resumable: false,
    contentType: "application/pdf",
    metadata: {
      contentType: "application/pdf",
      metadata: {
        firebaseStorageDownloadTokens: token,
        source: "vat-mail-gmail",
        gmailMessageId: messageId,
        originalFilename: asString(opts.filename, 200),
      },
    },
  });
  return {
    path: objectPath,
    bucket: bucket.name,
    token,
    bytes: buffer.length,
  };
}

async function signedPdfReadUrl(objectPath, expiresMs = 60 * 60 * 1000) {
  const bucket = await resolveStorageBucket();
  const file = bucket.file(objectPath);
  const [url] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + expiresMs,
  });
  return url;
}

/**
 * Download PDF attachments → store files + extract text.
 * เก็บไฟล์แม้ถอดข้อความไม่ได้ (เปิดดูทีหลังได้)
 */
async function extractPdfTextFromMessage(accessToken, messageId, payload) {
  const parts = listPdfParts(payload).slice(0, 2);
  if (!parts.length) {
    return {
      text: "",
      filenames: [],
      storagePaths: [],
      stored: [],
      error: "ไม่พบไฟล์ PDF แนบ",
    };
  }
  const chunks = [];
  const filenames = [];
  const storagePaths = [];
  const stored = [];
  const errors = [];
  const year = new Date().getFullYear();

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

      const name = part.filename || "attachment.pdf";
      filenames.push(name);

      // เก็บไฟล์ก่อน — สำคัญแม้ parse ข้อความพัง
      try {
        const saved = await storeMailPdfBuffer(buf, {
          messageId,
          filename: name,
          year,
        });
        storagePaths.push(saved.path);
        stored.push(saved);
      } catch (e) {
        errors.push(`store ${name}: ${asString(e?.message || String(e), 100)}`);
        console.warn("vat-mail-pdf store", name, e?.message || e);
      }

      try {
        const text = await pdfBufferToText(buf);
        if (text.length >= 20) {
          chunks.push(`# file: ${name}\n${text}`);
        } else {
          errors.push(`${name}: อ่านข้อความไม่ได้ (อาจเป็นรูปสแกนหรือมีรหัสผ่าน)`);
        }
      } catch (e) {
        const msg = e?.message || String(e);
        errors.push(`${name}: ${String(msg).slice(0, 120)}`);
      }
    } catch (e) {
      const msg = e?.message || String(e);
      console.warn("vat-mail-pdf extract", part.filename, msg);
      errors.push(`${part.filename || "pdf"}: ${String(msg).slice(0, 120)}`);
    }
  }

  const text = chunks.join("\n\n").slice(0, MAX_PDF_TEXT);
  return {
    text,
    filenames,
    storagePaths,
    stored,
    error: text
      ? ""
      : storagePaths.length
        ? errors[0] || "เก็บ PDF แล้ว แต่ถอดข้อความไม่ได้"
        : errors[0] || "ดึง PDF ไม่สำเร็จ",
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

  const paths = Array.isArray(doc.pdfStoragePaths) ? doc.pdfStoragePaths : [];
  const raw = String(doc.rawText || "");
  // ยังไม่เก็บไฟล์ PDF
  if (!paths.length) return true;
  // ยังไม่มีข้อความ PDF
  if (!raw.includes("--- PDF ---")) return true;
  const pdfPart = raw.split("--- PDF ---")[1] || "";
  if (pdfPart.trim().length < 40) return true;
  if (status === "fail" && /PDF|ป้ายยอด|ยอดขาย|ลูกค้า/i.test(String(doc.parseError || ""))) {
    return true;
  }
  return false;
}

module.exports = {
  PDF_MARKER,
  MAX_PDF_BYTES,
  listPdfParts,
  listDriveableParts,
  matchDriveableKind,
  fetchAttachmentBuffer,
  decodeAttachmentData,
  extractPdfTextFromMessage,
  mergeBodyWithPdf,
  needsPdfEnrich,
  pdfBufferToText,
  storeMailPdfBuffer,
  signedPdfReadUrl,
  safeFilename,
};
