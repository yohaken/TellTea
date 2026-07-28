/**
 * Delete nPos sales rounds (posSessions) + bills (posSales / posSaleMutations)
 * for every device except keepPairingCode (default 570F0F = SUNMI shop).
 *
 * Dry-run by default. Apply with APPLY=1.
 *
 *   FIREBASE_SERVICE_ACCOUNT='{...}' node scripts/purge-npos-sales-keep.mjs
 *   FIREBASE_SERVICE_ACCOUNT='{...}' APPLY=1 node scripts/purge-npos-sales-keep.mjs
 *   FIREBASE_SERVICE_ACCOUNT='{...}' APPLY=1 PURGE_DEVICES=1 node scripts/purge-npos-sales-keep.mjs
 *
 * PURGE_DEVICES=1 also deletes other posDevices + diagnose/ops/captures
 * (same idea as nposOwnerDeviceCommand purge_dev_devices).
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT = process.env.FIREBASE_PROJECT_ID || "mypeer-501909";
const KEEP = (process.env.KEEP_PAIRING || "570F0F").trim().toUpperCase();
const APPLY = process.env.APPLY === "1" || process.env.APPLY === "true";
const PURGE_DEVICES =
  process.env.PURGE_DEVICES === "1" || process.env.PURGE_DEVICES === "true";

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

function asString(v, max = 200) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

function pairingCodeFromId(id) {
  return String(id || "")
    .replace(/-/g, "")
    .slice(-6)
    .toUpperCase();
}

function devicePairingCode(id, data) {
  const raw =
    typeof data?.pairingCode === "string" ? data.pairingCode.trim().toUpperCase() : "";
  if (raw.length >= 4) return raw;
  return pairingCodeFromId(id);
}

async function commitDeletes(db, refs) {
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
  return deleted;
}

async function main() {
  const db = getAdminDb();
  const devicesSnap = await db.collection("posDevices").get();

  const keepIds = new Set();
  const purgeIds = new Set();
  const keepRows = [];
  const purgeRows = [];

  for (const docSnap of devicesSnap.docs) {
    const data = docSnap.data() || {};
    const code = devicePairingCode(docSnap.id, data);
    const row = {
      id: docSnap.id,
      pairingCode: code,
      label: asString(data.label, 80),
      deviceHint: asString(data.deviceHint, 80),
    };
    if (code === KEEP) {
      keepIds.add(docSnap.id);
      keepRows.push(row);
    } else {
      purgeIds.add(docSnap.id);
      purgeRows.push(row);
    }
  }

  if (keepIds.size === 0) {
    throw new Error(`ไม่พบเครื่องรหัส ${KEEP} — ไม่ลบอะไรเพื่อกันพลาด`);
  }

  const [sessionsSnap, salesSnap, mutationsSnap, diagSnap, opsSnap, shotsSnap] =
    await Promise.all([
      db.collection("posSessions").get(),
      db.collection("posSales").get(),
      db.collection("posSaleMutations").get(),
      PURGE_DEVICES ? db.collection("nposDiagnose").get() : Promise.resolve(null),
      PURGE_DEVICES ? db.collection("nposOpsLog").get() : Promise.resolve(null),
      PURGE_DEVICES ? db.collection("nposScreenShots").get() : Promise.resolve(null),
    ]);

  const sessionRefs = [];
  let keepSessions = 0;
  for (const docSnap of sessionsSnap.docs) {
    const deviceId = asString((docSnap.data() || {}).deviceId, 64);
    if (keepIds.has(deviceId)) keepSessions += 1;
    else sessionRefs.push(docSnap.ref);
  }

  const saleRefs = [];
  let keepSales = 0;
  for (const docSnap of salesSnap.docs) {
    const deviceId = asString((docSnap.data() || {}).deviceId, 64);
    if (keepIds.has(deviceId)) keepSales += 1;
    else saleRefs.push(docSnap.ref);
  }

  const mutationRefs = [];
  let keepMutations = 0;
  for (const docSnap of mutationsSnap.docs) {
    const deviceId = asString((docSnap.data() || {}).deviceId, 64);
    if (keepIds.has(deviceId)) keepMutations += 1;
    else mutationRefs.push(docSnap.ref);
  }

  const deviceRefs = [];
  const diagnoseRefs = [];
  const opsRefs = [];
  const shotRefs = [];
  if (PURGE_DEVICES) {
    for (const id of purgeIds) deviceRefs.push(db.collection("posDevices").doc(id));
    for (const docSnap of diagSnap.docs) {
      if (!keepIds.has(docSnap.id)) diagnoseRefs.push(docSnap.ref);
    }
    for (const docSnap of opsSnap.docs) {
      if (!keepIds.has(docSnap.id)) opsRefs.push(docSnap.ref);
    }
    for (const docSnap of shotsSnap.docs) {
      const installId = asString((docSnap.data() || {}).installId, 64);
      if (!keepIds.has(installId)) shotRefs.push(docSnap.ref);
    }
  }

  const plan = {
    at: new Date().toISOString(),
    project: PROJECT,
    keepPairingCode: KEEP,
    apply: APPLY,
    purgeDevices: PURGE_DEVICES,
    shopKept: keepIds.size,
    keptDevices: keepRows,
    purgeDeviceCount: purgeIds.size,
    purgeDevicesSample: purgeRows.slice(0, 20),
    willDelete: {
      sessions: sessionRefs.length,
      sales: saleRefs.length,
      mutations: mutationRefs.length,
      devices: deviceRefs.length,
      diagnose: diagnoseRefs.length,
      ops: opsRefs.length,
      shots: shotRefs.length,
    },
    willKeep: {
      sessions: keepSessions,
      sales: keepSales,
      mutations: keepMutations,
    },
  };

  console.log(JSON.stringify(plan, null, 2));

  if (!APPLY) {
    console.log("\nDRY-RUN เท่านั้น — ตั้ง APPLY=1 เพื่อลบจริง");
    return;
  }

  const deletedSessions = await commitDeletes(db, sessionRefs);
  const deletedSales = await commitDeletes(db, saleRefs);
  const deletedMutations = await commitDeletes(db, mutationRefs);
  let deletedDevices = 0;
  let deletedDiagnose = 0;
  let deletedOps = 0;
  let deletedShots = 0;
  if (PURGE_DEVICES) {
    deletedDevices = await commitDeletes(db, deviceRefs);
    deletedDiagnose = await commitDeletes(db, diagnoseRefs);
    deletedOps = await commitDeletes(db, opsRefs);
    deletedShots = await commitDeletes(db, shotRefs);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        keepPairingCode: KEEP,
        shopKept: keepIds.size,
        deletedSessions,
        deletedSales,
        deletedMutations,
        deletedDevices,
        deletedDiagnose,
        deletedOps,
        deletedShots,
        keptSessions: keepSessions,
        keptSales: keepSales,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
