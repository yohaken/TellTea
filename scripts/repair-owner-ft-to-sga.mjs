/**
 * Owner books: reclassify "ft…" freight-like rows from asset → sga.
 *
 * Match (case-insensitive):
 *   - description contains "ft.." or "ft."
 *   - OR description starts with "ft" / "ft " / "ft-" / "ft/"
 * Only rows currently typed as asset/assets are updated.
 *
 *   APPLY=1 FIREBASE_SERVICE_ACCOUNT='{...}' node scripts/repair-owner-ft-to-sga.mjs
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT = process.env.FIREBASE_PROJECT_ID || "mypeer-501909";
const APPLY = process.env.APPLY === "1" || process.env.APPLY === "true";
const FROM_TYPES = new Set(["asset", "assets"]);
const TO_TYPE = "sga";

/** Broader than literal "ft.." — covers ft. / FT- / freight codes users search as ft */
function isFtDescription(description) {
  const d = String(description || "").trim();
  if (!d) return false;
  if (/ft\.\./i.test(d)) return true;
  if (/ft\./i.test(d)) return true;
  if (/^ft([\s\-_/]|$)/i.test(d)) return true;
  if (/\bft[\s\-_/]/i.test(d)) return true;
  return false;
}

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

  const byType = new Map();
  const assetRows = [];
  const ftRows = [];

  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const description = String(data.description || "");
    const typeKey = canonicalType(data.type);
    byType.set(typeKey || "(empty)", (byType.get(typeKey || "(empty)") || 0) + 1);

    const row = {
      id: doc.id,
      description,
      type: data.type || "",
      typeKey,
      amountOut: Number(data.amountOut) || 0,
      date: data.date,
    };

    if (FROM_TYPES.has(typeKey)) assetRows.push(row);
    if (isFtDescription(description)) ftRows.push(row);
  }

  assetRows.sort((a, b) => Number(a.date || 0) - Number(b.date || 0));
  ftRows.sort((a, b) => Number(a.date || 0) - Number(b.date || 0));

  const toFix = ftRows.filter((m) => FROM_TYPES.has(m.typeKey));

  console.log(`ownerBooks total docs: ${snap.size}`);
  console.log("type counts:", Object.fromEntries([...byType.entries()].sort((a, b) => b[1] - a[1])));
  console.log(`asset rows: ${assetRows.length}`);
  console.log(`ft-like description rows: ${ftRows.length}`);
  console.log(`ft-like + asset (to fix): ${toFix.length}`);
  console.log(`mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log("--- ft-like rows ---");
  for (const m of ftRows) {
    const flag = FROM_TYPES.has(m.typeKey) ? "FIX" : m.typeKey === "sga" ? "ok" : "skip";
    console.log(
      `[${flag}] ${formatDate(m.date)} | ${m.type || "(empty)"} | ${m.amountOut} | ${m.description} | ${m.id}`,
    );
  }

  if (!ftRows.length) {
    console.log("--- sample asset descriptions (first 40) ---");
    for (const m of assetRows.slice(0, 40)) {
      console.log(
        `${formatDate(m.date)} | ${m.amountOut} | ${m.description}`,
      );
    }
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
