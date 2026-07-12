/**
 * Move legacy personal fields from staff/{id} → staffPersonal/{id}.
 *
 * Usage:
 *   FIREBASE_SERVICE_ACCOUNT='{"type":"service_account",...}' node scripts/migrate-staff-personal.mjs
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const PROJECT = process.env.FIREBASE_PROJECT_ID || "mypeer-501909";

function loadCredentials() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_KEY;
  if (raw && raw.trim().startsWith("{")) {
    return JSON.parse(raw);
  }
  return undefined;
}

function getAdminDb() {
  if (!getApps().length) {
    const credentials = loadCredentials();
    initializeApp({
      credential: cert(credentials),
      projectId: PROJECT,
    });
  }
  return getFirestore();
}

async function main() {
  const db = getAdminDb();
  const snap = await db.collection("staff").get();
  let moved = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const hasLegacy =
      data.legalFirstName ||
      data.legalLastName ||
      data.idCardPhotoUrl ||
      data.personalDataConsentAt;
    if (!hasLegacy) {
      skipped += 1;
      continue;
    }

    const personalRef = db.collection("staffPersonal").doc(doc.id);
    const existing = await personalRef.get();
    const patch = {
      updatedAt: Date.now(),
    };
    if (data.legalFirstName) patch.legalFirstName = data.legalFirstName;
    if (data.legalLastName) patch.legalLastName = data.legalLastName;
    if (data.idCardPhotoUrl) patch.idCardPhotoUrl = data.idCardPhotoUrl;
    if (data.personalDataConsentAt) patch.personalDataConsentAt = data.personalDataConsentAt;

    if (existing.exists()) {
      await personalRef.set(patch, { merge: true });
    } else {
      await personalRef.set(patch);
    }

    await doc.ref.update({
      legalFirstName: FieldValue.delete(),
      legalLastName: FieldValue.delete(),
      idCardPhotoUrl: FieldValue.delete(),
      personalDataConsentAt: FieldValue.delete(),
    });

    moved += 1;
    console.log("migrated:", doc.id);
  }

  console.log(`Done. moved=${moved} skipped=${skipped} total=${snap.size}`);
}

main().catch((err) => {
  console.error("migrate-staff-personal failed:", err.message || err);
  process.exit(1);
});
