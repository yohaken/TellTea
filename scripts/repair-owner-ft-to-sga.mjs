/**
 * Owner books: reclassify descriptions matching "ft.." from asset → sga.
 *
 *   FIREBASE_SERVICE_ACCOUNT='{...}' node scripts/repair-owner-ft-to-sga.mjs
 *   APPLY=1 FIREBASE_SERVICE_ACCOUNT='{...}' node scripts/repair-owner-ft-to-sga.mjs
 *
 * Default is dry-run (list only). Set APPLY=1 to write.
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT = process.env.FIREBASE_PROJECT_ID || "mypeer-501909";
const APPLY = process.env.APPLY === "1" || process.env.APPLY === "true";
/** Matches user query: descriptions containing "ft.." (case-insensitive). */
const FT_RE = /ft\.\./i;
const FROM_TYPES = new Set(["asset", "assets"]);
const TO_TYPE = "sga";

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

function canonicalType(raw) {
  const t = String(raw || "").trim().toLowerCase();
  if (t === "assets") return "asset";
  if (t === "cosg") return "cogs";
  if (t === "other" || t === "others") return "อื่นๆ";
  return t || "";
}

function formatDate(ms) {
  if (!ms) return "—";
  const d = new Date(Number(ms));
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString("th-TH", { year: "numeric", month: "2-digit", day: "2-digit" });
}

async function main() {
  const db = getAdminDb();
  const snap = await db.collection("ownerBooks").get();
  const matches = [];
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const description = String(data.description || "");
    if (!FT_RE.test(description)) continue;
    const type = canonicalType(data.type);
    matches.push({
      id: doc.id,
      description,
      type: data.type || "",
      typeKey: type,
      amountOut: Number(data.amountOut) || 0,
      date: data.date,
    });
  }

  matches.sort((a, b) => Number(a.date || 0) - Number(b.date || 0));

  const toFix = matches.filter((m) => FROM_TYPES.has(m.typeKey));
  const alreadySga = matches.filter((m) => m.typeKey === "sga");
  const other = matches.filter((m) => !FROM_TYPES.has(m.typeKey) && m.typeKey !== "sga");

  console.log(`ownerBooks total docs: ${snap.size}`);
  console.log(`description matches /ft\\.\\./i: ${matches.length}`);
  console.log(`  currently asset → will move to sga: ${toFix.length}`);
  console.log(`  already sga: ${alreadySga.length}`);
  console.log(`  other types: ${other.length}`);
  console.log(`mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log("---");

  for (const m of matches) {
    const flag = FROM_TYPES.has(m.typeKey)
      ? "FIX"
      : m.typeKey === "sga"
        ? "ok"
        : "skip";
    console.log(
      `[${flag}] ${formatDate(m.date)} | ${m.type || "(empty)"} | ${m.amountOut} | ${m.description} | ${m.id}`,
    );
  }

  if (toFix.length !== 17 && matches.length !== 17) {
    console.warn(
      `\nNOTE: expected ~17 ft.. rows; found ${matches.length} matches (${toFix.length} asset). Continuing with what we found.`,
    );
  }

  if (!APPLY) {
    console.log("\nDry-run only. Re-run with APPLY=1 to update.");
    return;
  }

  if (!toFix.length) {
    console.log("Nothing to update.");
    return;
  }

  let updated = 0;
  const batchSize = 400;
  for (let i = 0; i < toFix.length; i += batchSize) {
    const chunk = toFix.slice(i, i + batchSize);
    const batch = db.batch();
    for (const m of chunk) {
      batch.update(db.collection("ownerBooks").doc(m.id), {
        type: TO_TYPE,
        typeSource: "owner",
        typeAiReason: "reclass ft.. asset→sga (owner request 2026-07-22)",
        updatedAt: Date.now(),
      });
    }
    await batch.commit();
    updated += chunk.length;
  }

  console.log(`\nUpdated ${updated} ownerBooks docs → type=sga`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
