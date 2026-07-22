/**
 * Owner back-office commands for nPos devices — Admin SDK write.
 * Avoids client Firestore rules friction (permission-denied on captureRequestAt).
 */
const functions = require("firebase-functions/v1");
const { getFirestore } = require("firebase-admin/firestore");

const COL = "posDevices";
const OWNER_EMAIL = String(process.env.TELLTEA_OWNER_EMAIL || "yohaken@gmail.com")
  .trim()
  .toLowerCase();

function asString(v, max = 200) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

function actorFromAuth(auth) {
  const email = asString(auth?.token?.email, 120).toLowerCase();
  if (email) return email;
  const phone = asString(auth?.token?.phone_number, 32);
  return phone || asString(auth?.uid, 64);
}

async function assertOwner(context) {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "ต้องเข้าสู่ระบบก่อน");
  }
  const email = asString(context.auth.token?.email, 120).toLowerCase();
  if (email && email === OWNER_EMAIL) {
    return { actorId: email };
  }

  const db = getFirestore();
  let staffId = email;
  if (!staffId) {
    const phone = asString(context.auth.token?.phone_number, 32);
    const digits = phone.startsWith("+") ? phone.slice(1) : phone;
    if (!digits) {
      throw new functions.https.HttpsError("permission-denied", "บัญชีนี้ไม่ใช่เจ้าของร้าน");
    }
    const phoneSnap = await db.collection("staffPhones").doc(digits).get();
    staffId = asString(phoneSnap.exists ? phoneSnap.get("staffId") : "", 120);
  }
  if (!staffId) {
    throw new functions.https.HttpsError("permission-denied", "บัญชีนี้ไม่ใช่เจ้าของร้าน");
  }
  const staffSnap = await db.collection("staff").doc(staffId).get();
  if (!staffSnap.exists || staffSnap.get("role") !== "owner") {
    throw new functions.https.HttpsError("permission-denied", "บัญชีนี้ไม่ใช่เจ้าของร้าน");
  }
  return { actorId: staffId };
}

exports.nposOwnerDeviceCommand = functions
  .region("asia-southeast1")
  .https.onCall(async (data, context) => {
    const { actorId } = await assertOwner(context);
    const deviceId = asString(data?.deviceId, 64);
    if (!deviceId || deviceId.length < 8 || !/^[a-zA-Z0-9_-]+$/.test(deviceId)) {
      throw new functions.https.HttpsError("invalid-argument", "deviceId ไม่ถูกต้อง");
    }
    const action = asString(data?.action, 32).toLowerCase();
    const db = getFirestore();
    const ref = db.collection(COL).doc(deviceId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new functions.https.HttpsError("not-found", "ไม่พบเครื่องนี้ในระบบ");
    }

    const now = Date.now();
    let patch = { updatedAt: now, updatedBy: actorId };

    if (action === "capture") {
      patch.captureRequestAt = now;
    } else if (action === "capture_interval") {
      const allowed = new Set([0, 5, 10, 30]);
      const mins = Number(data?.intervalMinutes);
      const intervalMinutes = allowed.has(mins) ? mins : 0;
      patch.captureIntervalMinutes = intervalMinutes;
    } else if (action === "block") {
      patch = {
        ...patch,
        blocked: true,
        disabled: true,
        deviceClass: "blocked",
      };
    } else if (action === "unblock") {
      const isEmulator = data?.isEmulator === true || snap.get("isEmulator") === true;
      patch = {
        ...patch,
        blocked: false,
        disabled: false,
        deviceClass: isEmulator ? "dev" : "shop",
      };
    } else {
      throw new functions.https.HttpsError("invalid-argument", "action ไม่รู้จัก");
    }

    await ref.set(patch, { merge: true });
    return { ok: true, deviceId, action, at: now };
  });
