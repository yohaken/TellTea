/**
 * Retention helpers for nPos screen captures.
 * Cap per install + clear-all (Storage objects + Firestore docs).
 */
const { getFirestore } = require("firebase-admin/firestore");
const { resolveStorageBucket } = require("./storage-bucket");

const MAX_SHOTS_PER_INSTALL = 50;
const SHOTS_COL = "nposScreenShots";

function asString(v, max = 200) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

async function deleteStoragePath(path) {
  const p = asString(path, 400);
  if (!p.startsWith("npos-screenshots/")) return;
  try {
    const bucket = await resolveStorageBucket();
    await bucket.file(p).delete({ ignoreNotFound: true });
  } catch (err) {
    console.warn("npos-capture-prune delete storage", p, err?.message || err);
  }
}

async function deleteShotDoc(docSnap) {
  const data = docSnap.data() || {};
  const primary = data.primary && typeof data.primary === "object" ? data.primary : {};
  const secondary = data.secondary && typeof data.secondary === "object" ? data.secondary : {};
  await Promise.all([deleteStoragePath(primary.path), deleteStoragePath(secondary.path)]);
  await docSnap.ref.delete();
}

async function listShotsForInstall(db, installId) {
  const snap = await db.collection(SHOTS_COL).where("installId", "==", installId).get();
  return snap.docs
    .slice()
    .sort((a, b) => {
      const at = Number(b.data()?.capturedAt) || 0;
      const bt = Number(a.data()?.capturedAt) || 0;
      return at - bt; // newest first
    });
}

/** Keep newest `keep` shots; delete older excess (docs + Storage). */
async function pruneNposShotsForInstall(installId, keep = MAX_SHOTS_PER_INSTALL) {
  const id = asString(installId, 64);
  if (!id) return { pruned: 0 };
  const db = getFirestore();
  const docs = await listShotsForInstall(db, id);
  if (docs.length <= keep) return { pruned: 0, kept: docs.length };
  const excess = docs.slice(keep);
  for (const d of excess) {
    await deleteShotDoc(d);
  }
  return { pruned: excess.length, kept: keep };
}

async function clearLatestPointers(db, installId) {
  const now = Date.now();
  const patch = {
    latestCaptureAt: 0,
    latestCaptureId: "",
    latestPrimaryUrl: "",
    latestSecondaryUrl: "",
    latestCaptureReason: "",
    updatedAt: now,
  };
  await db.collection("nposDiagnose").doc(installId).set(patch, { merge: true });
  await db
    .collection("posDevices")
    .doc(installId)
    .set(
      {
        latestPrimaryUrl: "",
        latestSecondaryUrl: "",
        updatedAt: now,
      },
      { merge: true },
    );
}

/** Delete every capture for one install + clear diagnose/device latest URLs. */
async function clearNposShotsForInstall(installId) {
  const id = asString(installId, 64);
  if (!id) return { deleted: 0 };
  const db = getFirestore();
  const docs = await listShotsForInstall(db, id);
  for (const d of docs) {
    await deleteShotDoc(d);
  }
  await clearLatestPointers(db, id);
  return { deleted: docs.length, installId: id };
}

/** Delete all nposScreenShots (shop-wide) and clear known device pointers. */
async function clearAllNposShots() {
  const db = getFirestore();
  const snap = await db.collection(SHOTS_COL).get();
  const installIds = new Set();
  for (const d of snap.docs) {
    const installId = asString(d.data()?.installId, 64);
    if (installId) installIds.add(installId);
    await deleteShotDoc(d);
  }
  for (const id of installIds) {
    await clearLatestPointers(db, id);
  }
  return { deleted: snap.size, installs: installIds.size };
}

module.exports = {
  MAX_SHOTS_PER_INSTALL,
  pruneNposShotsForInstall,
  clearNposShotsForInstall,
  clearAllNposShots,
};
