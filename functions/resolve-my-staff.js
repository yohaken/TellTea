/**
 * Resolve the signed-in Auth user to a staff doc (Admin SDK).
 * Fixes Google logins whose email is only on a phone-keyed staff doc
 * (Jay/เตย class) — client email-doc lookup misses, and token often has
 * no phone_number for staffPhones fallback.
 *
 * Also stamps auth custom claim `staffId` + ensures staffEmails index.
 */
const functions = require("firebase-functions/v1");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");

const REGION = "asia-southeast1";

function asString(v, max = 200) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

function normalizeEmail(email) {
  return asString(email, 120).toLowerCase();
}

function phoneDigits(phone) {
  const raw = asString(phone, 32);
  if (!raw) return "";
  if (raw.startsWith("+")) return raw.slice(1).replace(/\D/g, "");
  return raw.replace(/\D/g, "");
}

function mapStaffPayload(id, data) {
  const d = data || {};
  return {
    id,
    email: asString(d.email, 120).toLowerCase() || undefined,
    phone: asString(d.phone, 32) || undefined,
    role: d.role === "owner" ? "owner" : "staff",
    displayName: asString(d.displayName, 80) || undefined,
    employeeId: asString(d.employeeId, 80) || undefined,
    profileComplete: d.profileComplete === true,
    profileSnoozeUntil: Number(d.profileSnoozeUntil) || undefined,
    personalProfileComplete: d.personalProfileComplete === true,
    createdAt: Number(d.createdAt) || 0,
    permissions: d.permissions && typeof d.permissions === "object" ? d.permissions : undefined,
    permissionLevelId: asString(d.permissionLevelId, 80) || undefined,
    permissionsCustomized: d.permissionsCustomized === true,
    lastSeenAt: Number(d.lastSeenAt) || undefined,
  };
}

async function findStaffId(db, email, phone) {
  if (email) {
    const byId = await db.collection("staff").doc(email).get();
    if (byId.exists) return email;

    const emailIdx = await db.collection("staffEmails").doc(email).get();
    if (emailIdx.exists) {
      const mapped = asString(emailIdx.get("staffId"), 160);
      if (mapped) return mapped;
    }

    const q = await db.collection("staff").where("email", "==", email).limit(3).get();
    if (!q.empty) return q.docs[0].id;
  }

  const digits = phoneDigits(phone);
  if (digits) {
    const phoneIdx = await db.collection("staffPhones").doc(digits).get();
    if (phoneIdx.exists) {
      const mapped = asString(phoneIdx.get("staffId"), 160);
      if (mapped) return mapped;
    }
    const pId = `p_${digits}`;
    const byPhoneId = await db.collection("staff").doc(pId).get();
    if (byPhoneId.exists) return pId;
  }

  return "";
}

async function ensureIndexes(db, staffId, email, phone) {
  const id = asString(staffId, 160);
  if (!id) return;
  if (email) {
    await db.collection("staffEmails").doc(email).set({ staffId: id }, { merge: true });
  }
  const digits = phoneDigits(phone);
  if (digits) {
    await db.collection("staffPhones").doc(digits).set({ staffId: id }, { merge: true });
  }
}

async function stampStaffClaim(uid, staffId) {
  const id = asString(staffId, 160);
  if (!uid || !id) return false;
  const auth = getAuth();
  const user = await auth.getUser(uid);
  const prev = user.customClaims || {};
  if (prev.staffId === id) return false;
  await auth.setCustomUserClaims(uid, { ...prev, staffId: id });
  return true;
}

exports.resolveMyStaff = functions.region(REGION).https.onCall(async (_data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "ต้องเข้าสู่ระบบก่อน");
  }
  const db = getFirestore();
  const email = normalizeEmail(context.auth.token?.email || "");
  const phone = asString(context.auth.token?.phone_number, 32);
  const staffId = await findStaffId(db, email, phone);
  if (!staffId) {
    return { ok: false, staff: null };
  }
  const snap = await db.collection("staff").doc(staffId).get();
  if (!snap.exists) {
    return { ok: false, staff: null };
  }
  const data = snap.data() || {};
  const staffEmail = normalizeEmail(data.email) || email;
  const staffPhone = asString(data.phone, 32) || phone;
  await ensureIndexes(db, staffId, staffEmail, staffPhone);
  const claimUpdated = await stampStaffClaim(context.auth.uid, staffId);
  return {
    ok: true,
    staff: mapStaffPayload(staffId, data),
    claimUpdated,
    staffId,
  };
});

exports._findStaffId = findStaffId;
exports._mapStaffPayload = mapStaffPayload;
