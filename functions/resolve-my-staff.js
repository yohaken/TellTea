/**
 * Resolve the signed-in Auth user to a staff doc (Admin SDK).
 * Fixes Google logins whose email is only on a phone-keyed staff doc
 * (Jay/เตย class) — client email-doc lookup misses, and token often has
 * no phone_number for staffPhones fallback.
 *
 * When token has email + roster doc is p_* with that email field, migrate
 * the staff doc to staff/{email} so EXISTING email-first Firestore rules
 * grant hasPerm without waiting on Rules API deploys (often 503).
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
    loginPinSetAt: Number(d.loginPinSetAt) || undefined,
  };
}

function phoneKeyVariants(phone) {
  const digits = phoneDigits(phone);
  const keys = new Set();
  if (!digits) return [];
  keys.add(digits);
  if (digits.startsWith("66") && digits.length >= 11) {
    keys.add(digits.slice(2));
    keys.add(`0${digits.slice(2)}`);
  }
  if (digits.startsWith("0") && digits.length === 10) {
    keys.add(`66${digits.slice(1)}`);
  }
  return [...keys];
}

function phoneFieldVariants(phone) {
  const digits = phoneDigits(phone);
  const out = new Set();
  if (!digits) return [];
  out.add(`+${digits}`);
  out.add(digits);
  if (digits.startsWith("66") && digits.length >= 11) {
    const local = digits.slice(2);
    out.add(`+66${local}`);
    out.add(`0${local}`);
    out.add(local);
  }
  if (digits.startsWith("0") && digits.length === 10) {
    out.add(`+66${digits.slice(1)}`);
    out.add(`66${digits.slice(1)}`);
  }
  return [...out];
}

async function findStaffId(db, email, phone) {
  if (email === "yohaken@gmail.com") {
    return email;
  }

  if (email) {
    const byId = await db.collection("staff").doc(email).get();
    if (byId.exists) {
      const migratedTo = asString(byId.get("migratedTo"), 160);
      // Stale p_* leftover should not win — email doc is canonical
      if (!migratedTo) return email;
      return email;
    }

    const emailIdx = await db.collection("staffEmails").doc(email).get();
    if (emailIdx.exists) {
      const mapped = asString(emailIdx.get("staffId"), 160);
      if (mapped) return mapped;
    }

    const q = await db.collection("staff").where("email", "==", email).limit(3).get();
    if (!q.empty) {
      // Prefer non-migrated / email-id docs
      const emailDoc = q.docs.find((d) => d.id === email);
      if (emailDoc) return email;
      const live = q.docs.find((d) => !asString(d.get("migratedTo"), 160));
      return (live || q.docs[0]).id;
    }
  }

  for (const key of phoneKeyVariants(phone)) {
    const phoneIdx = await db.collection("staffPhones").doc(key).get();
    if (phoneIdx.exists) {
      const mapped = asString(phoneIdx.get("staffId"), 160);
      if (mapped) return mapped;
    }
    const pId = `p_${key}`;
    const byPhoneId = await db.collection("staff").doc(pId).get();
    if (byPhoneId.exists) {
      const migratedTo = asString(byPhoneId.get("migratedTo"), 160);
      if (migratedTo) return migratedTo;
      return pId;
    }
  }

  for (const field of phoneFieldVariants(phone)) {
    const q = await db.collection("staff").where("phone", "==", field).limit(3).get();
    if (q.empty) continue;
    const owner = q.docs.find((d) => d.get("role") === "owner" && !asString(d.get("migratedTo"), 160));
    if (owner) return owner.id;
    const live = q.docs.find((d) => !asString(d.get("migratedTo"), 160));
    return (live || q.docs[0]).id;
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

/**
 * Move phone-keyed roster → staff/{email} so email-first rules grant isStaff/hasPerm.
 * Safe when email doc does not exist yet (or is the same migration target).
 */
async function migratePhoneKeyedToEmail(db, phoneStaffId, email) {
  const fromId = asString(phoneStaffId, 160);
  const toEmail = normalizeEmail(email);
  if (!fromId || !toEmail || !fromId.startsWith("p_")) return { staffId: fromId, migrated: false };
  if (fromId === toEmail) return { staffId: toEmail, migrated: false };
  // Never move or overwrite the shop-owner roster row
  if (toEmail === "yohaken@gmail.com") return { staffId: fromId, migrated: false };

  const fromRef = db.collection("staff").doc(fromId);
  const toRef = db.collection("staff").doc(toEmail);
  const fromSnap = await fromRef.get();
  if (!fromSnap.exists) return { staffId: fromId, migrated: false };
  if (fromSnap.get("role") === "owner") return { staffId: fromId, migrated: false };

  const already = asString(fromSnap.get("migratedTo"), 160);
  if (already === toEmail) {
    const toSnap = await toRef.get();
    if (toSnap.exists) return { staffId: toEmail, migrated: false };
  }

  const toSnap = await toRef.get();
  if (toSnap.exists && toSnap.get("role") === "owner") {
    return { staffId: toEmail, migrated: false };
  }
  if (toSnap.exists && !asString(toSnap.get("migratedFrom"), 160)) {
    // Email doc already owned — use it; retarget indexes from phone id
    const phone = asString(fromSnap.get("phone"), 32);
    await ensureIndexes(db, toEmail, toEmail, phone);
    await fromRef.set(
      { migratedTo: toEmail, migratedAt: Date.now() },
      { merge: true },
    );
    return { staffId: toEmail, migrated: true };
  }

  const data = { ...(fromSnap.data() || {}) };
  delete data.migratedTo;
  delete data.migratedAt;
  const payload = {
    ...data,
    email: toEmail,
    migratedFrom: fromId,
    migratedAt: Date.now(),
  };
  await toRef.set(payload, { merge: true });

  const phone = asString(data.phone, 32);
  await ensureIndexes(db, toEmail, toEmail, phone);

  // Roster links
  const empQ = await db
    .collection("employees")
    .where("linkedStaffId", "==", fromId)
    .limit(20)
    .get();
  for (const docSnap of empQ.docs) {
    await docSnap.ref.set(
      { linkedStaffId: toEmail, linkedEmail: toEmail, updatedAt: Date.now() },
      { merge: true },
    );
  }

  // Personal profile
  const personal = await db.collection("staffPersonal").doc(fromId).get();
  if (personal.exists) {
    await db.collection("staffPersonal").doc(toEmail).set(personal.data() || {}, { merge: true });
  }

  await fromRef.set(
    {
      migratedTo: toEmail,
      migratedAt: Date.now(),
      email: toEmail,
    },
    { merge: true },
  );

  return { staffId: toEmail, migrated: true };
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
  // Email/phone roster first — a stale staffId claim locked the owner out
  let staffId = await findStaffId(db, email, phone);
  if (!staffId) {
    const claimed = asString(context.auth.token?.staffId, 160);
    if (claimed) {
      const claimSnap = await db.collection("staff").doc(claimed).get();
      if (claimSnap.exists) {
        const migratedTo = asString(claimSnap.get("migratedTo"), 160);
        staffId = migratedTo || claimed;
      }
    }
  }
  if (!staffId) {
    return { ok: false, staff: null };
  }

  let migrated = false;
  if (email && staffId.startsWith("p_")) {
    const move = await migratePhoneKeyedToEmail(db, staffId, email);
    staffId = move.staffId;
    migrated = !!move.migrated;
  }

  if (email === "yohaken@gmail.com") {
    staffId = email;
    const ownerRef = db.collection("staff").doc(email);
    const ownerSnap = await ownerRef.get();
    if (!ownerSnap.exists) {
      await ownerRef.set(
        {
          email,
          role: "owner",
          profileComplete: true,
          createdAt: Date.now(),
        },
        { merge: true },
      );
    }
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
    migrated,
    staffId,
  };
});

exports._findStaffId = findStaffId;
exports._mapStaffPayload = mapStaffPayload;
exports._migratePhoneKeyedToEmail = migratePhoneKeyedToEmail;
