/**
 * HTTP dump สำหรับ cloud agent — อ่านบันทึกศึกษาเมล + แคตตาล็อก
 * Auth: Bearer token หรือ ?token= จาก meta/vatAgentApi (owner สร้างบนหน้า sources)
 *
 * GET/POST https://…/vatMailAgentDump
 */
const functions = require("firebase-functions/v1");
const { getFirestore } = require("firebase-admin/firestore");
const crypto = require("crypto");
const { matchChannel, isNoiseMail, isTaxInvoiceMail } = require("./vat-mail-channel");
const { inferMailStudyTags } = require("./vat-mail-study-tags");

const REGION = "asia-southeast1";
const AGENT_API_DOC = "meta/vatAgentApi";
const NOTES_DOC = "meta/vatMailStudyNotes";
const REPORTS_COL = "platformEmailReports";

function timingSafeEqualStr(a, b) {
  const aa = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function extractToken(req) {
  const auth = String(req.get("authorization") || "");
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  if (req.query && req.query.token) return String(req.query.token).trim();
  if (req.body && typeof req.body === "object" && req.body.token) {
    return String(req.body.token).trim();
  }
  return "";
}

function cors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
}

exports.vatMailAgentDump = functions
  .region(REGION)
  .runWith({ timeoutSeconds: 60, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    cors(res);
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "GET" && req.method !== "POST") {
      res.status(405).json({ ok: false, error: "method not allowed" });
      return;
    }

    try {
      const token = extractToken(req);
      if (!token || token.length < 16) {
        res.status(401).json({ ok: false, error: "missing token" });
        return;
      }

      const db = getFirestore();
      const apiSnap = await db.doc(AGENT_API_DOC).get();
      if (!apiSnap.exists || !apiSnap.get("token")) {
        res.status(403).json({ ok: false, error: "agent API not configured" });
        return;
      }
      const expected = String(apiSnap.get("token") || "");
      if (!timingSafeEqualStr(token, expected)) {
        res.status(403).json({ ok: false, error: "invalid token" });
        return;
      }
      if (apiSnap.get("enabled") === false) {
        res.status(403).json({ ok: false, error: "agent API disabled" });
        return;
      }

      const max = Math.min(
        200,
        Math.max(10, Number(req.query?.max || req.body?.max) || 80),
      );

      const notesSnap = await db.doc(NOTES_DOC).get();
      const notes = notesSnap.exists ? notesSnap.data() || {} : null;

      const reportsSnap = await db
        .collection(REPORTS_COL)
        .orderBy("receivedAt", "desc")
        .limit(max)
        .get()
        .catch(() => db.collection(REPORTS_COL).limit(max).get());

      const reports = reportsSnap.docs.map((d) => {
        const x = d.data() || {};
        const from = String(x.from || "");
        const subject = String(x.subject || "");
        const inferred = matchChannel(from, subject, null);
        const studyTags = Array.isArray(x.studyTags) ? x.studyTags : [];
        const suggestedTags = inferMailStudyTags(
          {
            from,
            subject,
            channel: inferred !== "unknown" ? inferred : x.channel,
            pdfFilenames: x.pdfFilenames,
            studyTags,
            reportKind: x.reportKind,
          },
          null,
        );
        return {
          id: d.id,
          channel: String(x.channel || "unknown"),
          inferredChannel: inferred,
          channelMismatch:
            inferred !== "unknown" && inferred !== String(x.channel || ""),
          receivedAt: Number(x.receivedAt) || 0,
          subject: subject.slice(0, 160),
          from: from.slice(0, 100),
          reportKind: String(x.reportKind || ""),
          studyTags,
          suggestedTags,
          files: Array.isArray(x.pdfFilenames)
            ? x.pdfFilenames.slice(0, 8)
            : [],
          noise: isNoiseMail(from, subject) || isTaxInvoiceMail(subject),
          snippet: String(x.snippet || "").slice(0, 180),
        };
      });

      await db.doc(AGENT_API_DOC).set(
        {
          lastUsedAt: Date.now(),
          lastUsedBy: "vatMailAgentDump",
        },
        { merge: true },
      );

      res.status(200).json({
        ok: true,
        generatedAt: new Date().toISOString(),
        notes: notes
          ? {
              text: String(notes.text || ""),
              updatedAt: Number(notes.updatedAt) || 0,
              updatedBy: String(notes.updatedBy || ""),
              reportCount: Number(notes.reportCount) || 0,
            }
          : null,
        reports,
        counts: {
          reports: reports.length,
          byChannel: reports.reduce((acc, r) => {
            acc[r.channel] = (acc[r.channel] || 0) + 1;
            return acc;
          }, {}),
          byInferred: reports.reduce((acc, r) => {
            acc[r.inferredChannel] = (acc[r.inferredChannel] || 0) + 1;
            return acc;
          }, {}),
          mismatch: reports.filter((r) => r.channelMismatch).length,
          noise: reports.filter((r) => r.noise).length,
        },
      });
    } catch (e) {
      console.error("vatMailAgentDump", e);
      res.status(500).json({
        ok: false,
        error: String(e?.message || e).slice(0, 200),
      });
    }
  });
