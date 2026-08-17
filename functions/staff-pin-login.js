/**
 * Staff PIN login — bypass Google / LINE WebView session breakage.
 * Owner sets a 4–6 digit PIN; staff signs in with nickname (or roster name) + PIN.
 * Secrets live in staffLoginSecrets (Admin-only). Public marker: staff.loginPinSetAt.
 */
const functions = require("firebase-functions/v1");
const crypto = require("crypto");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const { assertOwner } = require("./npos-owner-device");

const REGION = "asia-southeast1";
const MAX_FAILS = 8;
const LOCK_MS = 15 * 60 * 1000;
const PIN_RE = /^\d{4,6}$/;

function asString(v, max = 200) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

function normalizeEmail(email) {
  return asString(email, 120).toLowerCase();
}

function normalizeNick(raw) {
  return asString(raw, 40)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}_.-]/gu, "");
}

function nickKey(raw) {
  const n = normalizeNick(raw);
  return n || "";
}

function hashPin(pin, saltHex) {
  const salt = Buffer.from(saltHex, "hex");
  const derived = crypto.scryptSync(String(pin), salt, 32, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return derived.toString("hex");
}

function newSalt() {
  return crypto.randomBytes(16).toString("hex");
}

function timingSafeEqualHex(a, b) {
  try {
    const ba = Buffer.from(String(a), "hex");
    const bb = Buffer.from(String(b), "hex");
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

async function findStaffIdByLoginName(db, loginName) {
  const key = nickKey(loginName);
  if (!key) return "";

  const idx = await db.collection("staffNicknames").doc(key).get();
  if (idx.exists) {
    const mapped = asString(idx.get("staffId"), 160);
    if (mapped) {
      const live = await db.collection("staff").doc(mapped).get();
      if (live.exists && !asString(live.get("migratedTo"), 160)) return mapped;
      const migrated = asString(live.exists ? live.get("migratedTo") : "", 160);
      if (migrated) return migrated;
    }
  }

  const empSnap = await db.collection("employees").limit(200).get();
  for (const docSnap of empSnap.docs) {
    const d = docSnap.data() || {};
    const nick = nickKey(d.nickname || "");
    const name = nickKey(d.name || "");
    if (nick !== key && name !== key) continue;
    const linked = asString(d.linkedStaffId, 160);
    if (linked) {
      const live = await db.collection("staff").doc(linked).get();
      if (live.exists) {
        const migrated = asString(live.get("migratedTo"), 160);
        return migrated || linked;
      }
    }
  }

  const staffSnap = await db.collection("staff").limit(200).get();
  for (const docSnap of staffSnap.docs) {
    if (asString(docSnap.get("migratedTo"), 160)) continue;
    const display = nickKey(docSnap.get("displayName") || "");
    const email = normalizeEmail(docSnap.get("email") || "");
    const local = email.includes("@") ? nickKey(email.split("@")[0]) : "";
    if (display === key || local === key || nickKey(docSnap.id) === key) {
      return docSnap.id;
    }
  }

  return "";
}

async function syncNicknameIndexes(db, staffId, names) {
  const id = asString(staffId, 160);
  if (!id) return;
  const keys = new Set();
  for (const n of names || []) {
    const k = nickKey(n);
    if (k) keys.add(k);
  }
  for (const k of keys) {
    await db.collection("staffNicknames").doc(k).set(
      { staffId: id, updatedAt: Date.now() },
      { merge: true },
    );
  }
}

async function collectLoginNames(db, staffId, staffData) {
  const names = [];
  const display = asString(staffData.displayName, 80);
  if (display) names.push(display);
  const email = normalizeEmail(staffData.email || "");
  if (email.includes("@")) names.push(email.split("@")[0]);
  const empId = asString(staffData.employeeId, 80);
  if (empId) {
    const emp = await db.collection("employees").doc(empId).get();
    if (emp.exists) {
      const nick = asString(emp.get("nickname"), 40);
      const name = asString(emp.get("name"), 80);
      if (nick) names.push(nick);
      if (name) names.push(name);
    }
  }
  const linked = await db
    .collection("employees")
    .where("linkedStaffId", "==", staffId)
    .limit(5)
    .get();
  for (const docSnap of linked.docs) {
    const nick = asString(docSnap.get("nickname"), 40);
    const name = asString(docSnap.get("name"), 80);
    if (nick) names.push(nick);
    if (name) names.push(name);
  }
  return names;
}

async function ensureAuthUserForStaff(staffId, staffData) {
  const auth = getAuth();
  const email = normalizeEmail(staffData.email || "");
  let uid = "";
  if (email) {
    try {
      const existing = await auth.getUserByEmail(email);
      uid = existing.uid;
    } catch (err) {
      if (err && err.code === "auth/user-not-found") {
        const created = await auth.createUser({
          email,
          emailVerified: true,
          displayName: asString(staffData.displayName, 80) || undefined,
          disabled: false,
        });
        uid = created.uid;
      } else {
        throw err;
      }
    }
  } else {
    uid = `pin_${staffId}`.slice(0, 128);
    try {
      await auth.getUser(uid);
    } catch (err) {
      if (err && err.code === "auth/user-not-found") {
        await auth.createUser({
          uid,
          displayName: asString(staffData.displayName, 80) || staffId,
          disabled: false,
        });
      } else {
        throw err;
      }
    }
  }

  const user = await auth.getUser(uid);
  const prev = user.customClaims || {};
  await auth.setCustomUserClaims(uid, { ...prev, staffId });
  return uid;
}

async function checkAndBumpFails(db, staffId) {
  const ref = db.collection("staffPinAttempts").doc(staffId);
  const snap = await ref.get();
  const now = Date.now();
  const data = snap.exists ? snap.data() || {} : {};
  const lockedUntil = Number(data.lockedUntil) || 0;
  if (lockedUntil > now) {
    const mins = Math.max(1, Math.ceil((lockedUntil - now) / 60000));
    throw new functions.https.HttpsError(
      "resource-exhausted",
      `ลองผิดหลายครั้ง — รอ ${mins} นาทีแล้วลองใหม่`,
    );
  }
  const fails = (Number(data.fails) || 0) + 1;
  const patch = { fails, updatedAt: now };
  if (fails >= MAX_FAILS) {
    patch.lockedUntil = now + LOCK_MS;
    patch.fails = 0;
  }
  await ref.set(patch, { merge: true });
  throw new functions.https.HttpsError(
    "permission-denied",
    "ชื่อหรือ PIN ไม่ถูกต้อง",
  );
}

async function clearFails(db, staffId) {
  await db
    .collection("staffPinAttempts")
    .doc(staffId)
    .set({ fails: 0, lockedUntil: 0, updatedAt: Date.now() }, { merge: true });
}

/**
 * Public: nickname + PIN → Firebase custom token.
 */
exports.staffPinLogin = functions.region(REGION).https.onCall(async (data) => {
  const loginName = asString(data?.nickname ?? data?.loginName, 40);
  const pin = asString(data?.pin, 12);
  if (!nickKey(loginName)) {
    throw new functions.https.HttpsError("invalid-argument", "ใส่ชื่อเล่นหรือชื่อในร้าน");
  }
  if (!PIN_RE.test(pin)) {
    throw new functions.https.HttpsError("invalid-argument", "PIN ต้องเป็นตัวเลข 4–6 หลัก");
  }

  const db = getFirestore();
  const staffId = await findStaffIdByLoginName(db, loginName);
  if (!staffId) {
    // Uniform message — avoid username enumeration timing somewhat
    throw new functions.https.HttpsError("permission-denied", "ชื่อหรือ PIN ไม่ถูกต้อง");
  }

  const attemptRef = db.collection("staffPinAttempts").doc(staffId);
  const attemptSnap = await attemptRef.get();
  const lockedUntil = Number(attemptSnap.exists ? attemptSnap.get("lockedUntil") : 0) || 0;
  if (lockedUntil > Date.now()) {
    const mins = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 60000));
    throw new functions.https.HttpsError(
      "resource-exhausted",
      `ลองผิดหลายครั้ง — รอ ${mins} นาทีแล้วลองใหม่`,
    );
  }

  const secretSnap = await db.collection("staffLoginSecrets").doc(staffId).get();
  if (!secretSnap.exists) {
    await checkAndBumpFails(db, staffId);
  }
  const salt = asString(secretSnap.get("salt"), 64);
  const expected = asString(secretSnap.get("hash"), 128);
  if (!salt || !expected) {
    await checkAndBumpFails(db, staffId);
  }
  const actual = hashPin(pin, salt);
  if (!timingSafeEqualHex(actual, expected)) {
    await checkAndBumpFails(db, staffId);
  }

  const staffSnap = await db.collection("staff").doc(staffId).get();
  if (!staffSnap.exists) {
    throw new functions.https.HttpsError("not-found", "ไม่พบบัญชีพนักงาน");
  }
  const staffData = staffSnap.data() || {};
  if (asString(staffData.migratedTo, 160)) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "บัญชีนี้ถูกย้ายแล้ว — บอกเจ้าของตั้ง PIN ใหม่ที่บัญชีปัจจุบัน",
    );
  }

  await clearFails(db, staffId);
  const uid = await ensureAuthUserForStaff(staffId, staffData);
  const token = await getAuth().createCustomToken(uid, { staffId });
  return {
    ok: true,
    token,
    staffId,
    displayName: asString(staffData.displayName, 80) || undefined,
  };
});

/**
 * Owner: set or clear staff login PIN.
 * data: { staffId, pin?, clear?, nicknameHint? }
 */
exports.setStaffLoginPin = functions.region(REGION).https.onCall(async (data, context) => {
  await assertOwner(context);
  const staffId = asString(data?.staffId, 160);
  if (!staffId) {
    throw new functions.https.HttpsError("invalid-argument", "ต้องระบุ staffId");
  }
  const clear = data?.clear === true;
  const pin = asString(data?.pin, 12);
  const db = getFirestore();
  const staffRef = db.collection("staff").doc(staffId);
  const staffSnap = await staffRef.get();
  if (!staffSnap.exists) {
    throw new functions.https.HttpsError("not-found", "ไม่พบบัญชีพนักงาน");
  }
  if (asString(staffSnap.get("migratedTo"), 160)) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "บัญชีนี้ถูกย้ายแล้ว — ตั้ง PIN ที่บัญชีอีเมลใหม่",
    );
  }

  if (clear || pin === "") {
    await db.collection("staffLoginSecrets").doc(staffId).delete().catch(() => undefined);
    await staffRef.set(
      { loginPinSetAt: null, loginPinClearedAt: Date.now() },
      { merge: true },
    );
    return { ok: true, cleared: true, staffId };
  }

  if (!PIN_RE.test(pin)) {
    throw new functions.https.HttpsError("invalid-argument", "PIN ต้องเป็นตัวเลข 4–6 หลัก");
  }

  const salt = newSalt();
  const hash = hashPin(pin, salt);
  await db.collection("staffLoginSecrets").doc(staffId).set({
    salt,
    hash,
    algo: "scrypt",
    updatedAt: Date.now(),
  });
  const now = Date.now();
  await staffRef.set({ loginPinSetAt: now, loginPinClearedAt: null }, { merge: true });

  const names = await collectLoginNames(db, staffId, staffSnap.data() || {});
  const hint = asString(data?.nicknameHint, 40);
  if (hint) names.push(hint);
  await syncNicknameIndexes(db, staffId, names);
  await clearFails(db, staffId);

  return { ok: true, staffId, loginPinSetAt: now, loginNames: names.map(nickKey).filter(Boolean) };
});

exports._nickKey = nickKey;
exports._hashPin = hashPin;
exports._findStaffIdByLoginName = findStaffIdByLoginName;
