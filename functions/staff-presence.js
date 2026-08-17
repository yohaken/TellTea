/**
 * Server-side staff BO presence (lastSeenAt).
 * Client Firestore rules often deny staff self-updates; Admin write is the source of truth.
 */
const functions = require("firebase-functions/v1");
const { getFirestore } = require("firebase-admin/firestore");

const REGION = "asia-southeast1";
/** Skip heartbeat spam when already fresh. */
const MIN_BUMP_GAP_MS = 15_000;

function asString(v, max = 200) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

function isStaffDocId(id) {
  const s = asString(id, 160);
  if (!s || s.startsWith("+")) return false;
  return s.includes("@") || s.startsWith("p_");
}

async function resolveStaffIdFromActor(db, actorId) {
  const raw = asString(actorId, 160);
  if (!raw) return "";
  if (raw.includes("@")) return raw.toLowerCase();
  if (raw.startsWith("p_")) return raw;
  if (raw.startsWith("+") || /^0\d{8,}$/.test(raw)) {
    const digits = raw.startsWith("+")
      ? raw.slice(1)
      : raw.replace(/\D/g, "").replace(/^0/, "66");
    if (!digits) return "";
    const phoneSnap = await db.collection("staffPhones").doc(digits).get();
    return asString(phoneSnap.exists ? phoneSnap.get("staffId") : "", 160);
  }
  return raw;
}

/**
 * Resolve the signed-in staff doc id.
 * Prefer email doc when it exists; else staffEmails / staffPhones / email field —
 * do NOT blindly trust token.email when that doc is missing (email-first rules trap).
 */
async function resolveCallerStaffId(auth) {
  if (!auth) return "";
  const db = getFirestore();
  const email = asString(auth.token?.email, 120).toLowerCase();
  const phone = asString(auth.token?.phone_number, 32);
  const claimId = asString(auth.token?.staffId, 160);

  if (claimId) {
    const byClaim = await db.collection("staff").doc(claimId).get();
    if (byClaim.exists) return claimId;
  }

  if (email) {
    const byEmail = await db.collection("staff").doc(email).get();
    if (byEmail.exists) return email;
    const emailIdx = await db.collection("staffEmails").doc(email).get();
    if (emailIdx.exists) {
      const mapped = asString(emailIdx.get("staffId"), 160);
      if (mapped) return mapped;
    }
    const q = await db.collection("staff").where("email", "==", email).limit(1).get();
    if (!q.empty) return q.docs[0].id;
  }

  if (phone) {
    const digits = phone.startsWith("+") ? phone.slice(1) : phone.replace(/\D/g, "");
    if (digits) {
      const phoneSnap = await db.collection("staffPhones").doc(digits).get();
      const mapped = asString(phoneSnap.exists ? phoneSnap.get("staffId") : "", 160);
      if (mapped) return mapped;
    }
  }

  return email;
}

async function bumpLastSeen(staffId, at) {
  const id = asString(staffId, 160);
  if (!isStaffDocId(id)) return { ok: false, reason: "bad-id" };
  const when = Number(at);
  const ts = Number.isFinite(when) && when > 0 ? Math.round(when) : Date.now();
  const db = getFirestore();
  const ref = db.collection("staff").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, reason: "missing-staff" };
  const prev = Number(snap.get("lastSeenAt")) || 0;
  if (prev >= ts) return { ok: true, skipped: true, prev, ts };

  const now = Date.now();
  // Throttle only near-realtime heartbeats; allow historical backfill from OT createdAt
  const isRealtime = Math.abs(now - ts) < 60_000;
  if (isRealtime && prev > 0 && now - prev < MIN_BUMP_GAP_MS) {
    return { ok: true, skipped: true, prev, ts: prev };
  }

  await ref.set({ lastSeenAt: ts }, { merge: true });
  return { ok: true, skipped: false, prev, ts };
}

/** Callable: staff/owner heartbeat — Admin write, ignores client rules. */
exports.touchStaffPresence = functions.region(REGION).https.onCall(async (_data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "ต้องเข้าสู่ระบบก่อน");
  }
  const staffId = await resolveCallerStaffId(context.auth);
  if (!staffId) {
    throw new functions.https.HttpsError("permission-denied", "ไม่พบบัญชีพนักงาน");
  }
  const result = await bumpLastSeen(staffId, Date.now());
  if (!result.ok && result.reason === "missing-staff") {
    throw new functions.https.HttpsError("not-found", "ไม่พบเอกสารพนักงาน");
  }
  return {
    ok: true,
    staffId,
    skipped: !!result.skipped,
    lastSeenAt: result.ts || Date.now(),
  };
});

/** OT create → lastSeenAt (เคสแป๋ม: สร้าง OT แล้ว client ปักไม่ติด) */
exports.onOtEntryCreatedForPresence = functions
  .region(REGION)
  .firestore.document("otEntries/{id}")
  .onCreate(async (snap) => {
    const data = snap.data() || {};
    const db = getFirestore();
    const staffId = await resolveStaffIdFromActor(db, data.createdBy);
    if (!staffId) return null;
    // createdAt only — ห้ามใช้ updatedAt จากสคริปต์ซ่อมเรท
    return bumpLastSeen(staffId, Number(data.createdAt) || Date.now());
  });

/** Production create → lastSeenAt */
exports.onProdEntryCreatedForPresence = functions
  .region(REGION)
  .firestore.document("prodEntries/{id}")
  .onCreate(async (snap) => {
    const data = snap.data() || {};
    const db = getFirestore();
    const staffId = await resolveStaffIdFromActor(db, data.createdBy);
    if (!staffId) return null;
    return bumpLastSeen(staffId, Number(data.createdAt) || Date.now());
  });

/** Stock round write → lastSeenAt from updatedBy/createdBy */
exports.onStockCountWrittenForPresence = functions
  .region(REGION)
  .firestore.document("stockCountSessions/{id}")
  .onWrite(async (change) => {
    const after = change.after;
    if (!after.exists) return null;
    const data = after.data() || {};
    const db = getFirestore();
    const actor = asString(data.updatedBy, 160) || asString(data.createdBy, 160);
    const staffId = await resolveStaffIdFromActor(db, actor);
    if (!staffId) return null;
    const at =
      Math.max(
        Number(data.updatedAt) || 0,
        Number(data.submittedAt) || 0,
        Number(data.createdAt) || 0,
      ) || Date.now();
    return bumpLastSeen(staffId, at);
  });

exports._bumpLastSeen = bumpLastSeen;
exports._resolveCallerStaffId = resolveCallerStaffId;
exports._resolveStaffIdFromActor = resolveStaffIdFromActor;
exports._isStaffDocId = isStaffDocId;
