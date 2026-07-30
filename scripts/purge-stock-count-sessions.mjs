/**
 * Clear stock count history (+ movements) so /stock/ can start fresh.
 * Keeps catalog `stock` items (names/units).
 *
 * Dry-run by default. Apply with APPLY=1.
 *
 *   FIREBASE_SERVICE_ACCOUNT='{...}' node scripts/purge-stock-count-sessions.mjs
 *   FIREBASE_SERVICE_ACCOUNT='{...}' APPLY=1 node scripts/purge-stock-count-sessions.mjs
 *   FIREBASE_SERVICE_ACCOUNT='{...}' APPLY=1 PURGE_MOVEMENTS=0 node scripts/purge-stock-count-sessions.mjs
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT = process.env.FIREBASE_PROJECT_ID || "mypeer-501909";
const APPLY = process.env.APPLY === "1" || process.env.APPLY === "true";
const PURGE_MOVEMENTS =
  process.env.PURGE_MOVEMENTS == null
    ? true
    : process.env.PURGE_MOVEMENTS === "1" || process.env.PURGE_MOVEMENTS === "true";

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

async function deleteCollection(db, name) {
  const snap = await db.collection(name).get();
  const refs = snap.docs.map((d) => d.ref);
  const sample = snap.docs.slice(0, 8).map((d) => {
    const data = d.data() || {};
    return {
      id: d.id,
      year: data.year ?? null,
      month: data.month ?? null,
      dayOfMonth: data.dayOfMonth ?? null,
      date: data.date ?? null,
    };
  });

  if (!APPLY) {
    return { name, count: refs.length, deleted: 0, sample };
  }

  let deleted = 0;
  const chunkSize = 400;
  for (let i = 0; i < refs.length; i += chunkSize) {
    const batch = db.batch();
    for (const ref of refs.slice(i, i + chunkSize)) {
      batch.delete(ref);
      deleted += 1;
    }
    await batch.commit();
  }
  return { name, count: refs.length, deleted, sample };
}

async function main() {
  const db = getAdminDb();
  const sessions = await deleteCollection(db, "stockCountSessions");
  const movements = PURGE_MOVEMENTS
    ? await deleteCollection(db, "stockMovements")
    : { name: "stockMovements", count: "skipped", deleted: 0, sample: [] };

  const stockSnap = await db.collection("stock").get();

  const report = {
    project: PROJECT,
    apply: APPLY,
    purgeMovements: PURGE_MOVEMENTS,
    stockCatalogKept: stockSnap.size,
    sessions,
    movements,
  };
  console.log(JSON.stringify(report, null, 2));

  if (!APPLY) {
    console.log("Dry-run only — set APPLY=1 to delete.");
    return;
  }

  const leftSessions = (await db.collection("stockCountSessions").get()).size;
  const leftMoves = PURGE_MOVEMENTS
    ? (await db.collection("stockMovements").get()).size
    : null;
  console.log(
    JSON.stringify(
      {
        verify: {
          stockCountSessionsLeft: leftSessions,
          stockMovementsLeft: leftMoves,
          stockCatalog: stockSnap.size,
        },
      },
      null,
      2,
    ),
  );
  if (leftSessions !== 0) {
    throw new Error(`purge incomplete: stockCountSessions left=${leftSessions}`);
  }
  if (PURGE_MOVEMENTS && leftMoves !== 0) {
    throw new Error(`purge incomplete: stockMovements left=${leftMoves}`);
  }
  console.log("OK purge-stock-count-sessions");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
