/**
 * Dump meta/vatMailStudyNotes (+ sample mail rows) for AI / Actions logs.
 *
 *   FIREBASE_SERVICE_ACCOUNT='{...}' node scripts/dump-vat-mail-study-notes.mjs
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT = process.env.FIREBASE_PROJECT_ID || "mypeer-501909";
const MAX_ROWS = Math.min(80, Math.max(10, Number(process.env.MAX_ROWS) || 40));

function loadCredentials() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_KEY;
  if (raw && raw.trim().startsWith("{")) return JSON.parse(raw);
  return undefined;
}

function getAdminDb() {
  if (!getApps().length) {
    const credentials = loadCredentials();
    if (!credentials) throw new Error("ต้องมี FIREBASE_SERVICE_ACCOUNT");
    initializeApp({ credential: cert(credentials), projectId: PROJECT });
  }
  return getFirestore();
}

function iso(ms) {
  if (!ms) return "";
  return new Date(ms).toISOString();
}

async function main() {
  const db = getAdminDb();
  const notesSnap = await db.doc("meta/vatMailStudyNotes").get();
  const notes = notesSnap.exists ? notesSnap.data() || {} : null;

  const reportsSnap = await db
    .collection("platformEmailReports")
    .orderBy("receivedAt", "desc")
    .limit(MAX_ROWS)
    .get()
    .catch(async () => {
      // fallback if index/order missing
      const all = await db.collection("platformEmailReports").limit(MAX_ROWS).get();
      return all;
    });

  const rows = reportsSnap.docs.map((d) => {
    const x = d.data() || {};
    return {
      id: d.id,
      channel: String(x.channel || ""),
      receivedAt: Number(x.receivedAt) || 0,
      subject: String(x.subject || "").slice(0, 140),
      from: String(x.from || "").slice(0, 80),
      reportKind: String(x.reportKind || ""),
      studyTags: Array.isArray(x.studyTags) ? x.studyTags : [],
      files: Array.isArray(x.pdfFilenames) ? x.pdfFilenames.slice(0, 6) : [],
    };
  });
  rows.sort((a, b) => b.receivedAt - a.receivedAt);

  console.log("=== VAT_MAIL_STUDY_NOTES_BEGIN ===");
  if (!notes) {
    console.log("(meta/vatMailStudyNotes ยังไม่มี — เจ้าของยังไม่กดอัปเดตบันทึก AI)");
  } else {
    console.log(`updatedAt: ${iso(notes.updatedAt)} · by ${notes.updatedBy || "?"} · reportCount=${notes.reportCount ?? "?"}`);
    console.log("---");
    console.log(String(notes.text || "").trim() || "(ว่าง)");
  }
  console.log("=== VAT_MAIL_STUDY_NOTES_END ===");

  console.log("");
  console.log(`=== PLATFORM_EMAIL_REPORTS sample (${rows.length}) ===`);
  for (const r of rows) {
    console.log(
      [
        iso(r.receivedAt).slice(0, 10) || "?",
        r.channel || "?",
        r.reportKind || "-",
        `tags=${r.studyTags.join(",") || "-"}`,
        `files=${r.files.join("|") || "-"}`,
        `from=${r.from || "-"}`,
        `subj=${r.subject || "-"}`,
      ].join(" · "),
    );
  }
  console.log("=== PLATFORM_EMAIL_REPORTS_END ===");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack || e.message : e);
  process.exit(1);
});
