/**
 * Owner back-office commands for nPos devices — Admin SDK write.
 * Avoids client Firestore rules friction (permission-denied on captureRequestAt).
 */
const functions = require("firebase-functions/v1");
const { getFirestore } = require("firebase-admin/firestore");
const {
  clearNposShotsForInstall,
  clearAllNposShots,
} = require("./npos-capture-prune");
const {
  META_POS,
  hashStoreCode,
  isValidStoreCodeShape,
  loadStoreClaimPolicy,
  normalizeStoreCode,
} = require("./npos-device-gate");

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
  .runWith({ memory: "512MB", timeoutSeconds: 120 })
  .https.onCall(async (data, context) => {
    const { actorId } = await assertOwner(context);
    const action = asString(data?.action, 32).toLowerCase();

    // Shop-wide clear — no deviceId required.
    if (action === "clear_captures_all") {
      const result = await clearAllNposShots();
      return { ok: true, action, actorId, at: Date.now(), ...result };
    }

    // Store claim code — shop-wide, no deviceId.
    if (action === "set_store_code") {
      const code = normalizeStoreCode(data?.storeCode);
      if (!isValidStoreCodeShape(code)) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "รหัสร้านต้องเป็น A–Z / 0–9 ความยาว 4–16 ตัว",
        );
      }
      const hash = hashStoreCode(code);
      const now = Date.now();
      const db = getFirestore();
      // Changing the secret clears the exclusive seat and revokes all claims.
      const claimed = await db.collection(COL).where("storeClaimed", "==", true).get();
      const batch = db.batch();
      batch.set(
        db.doc(META_POS),
        {
          storeClaimCodeHash: hash,
          storeClaimRequired: true,
          storeClaimRejectDev: data?.rejectDev === false ? false : true,
          storeClaimUpdatedAt: now,
          storeClaimUpdatedBy: actorId,
          seatMode: data?.seatMode === "multi" ? "multi" : "exclusive",
          activeSeatInstallId: "",
          seatClaimedAt: 0,
        },
        { merge: true },
      );
      claimed.forEach((docSnap) => {
        batch.set(
          docSnap.ref,
          {
            storeClaimed: false,
            storeClaimRevokedAt: now,
            storeClaimMethod: "revoked",
            storeClaimRevokeReason: "code_changed",
            updatedAt: now,
          },
          { merge: true },
        );
      });
      await batch.commit();
      return {
        ok: true,
        action,
        actorId,
        at: now,
        storeClaimRequired: true,
        codeHint: code.slice(0, 2) + "••" + code.slice(-2),
        revokedCount: claimed.size,
      };
    }

    if (action === "clear_store_code") {
      const now = Date.now();
      await getFirestore()
        .doc(META_POS)
        .set(
          {
            storeClaimCodeHash: "",
            storeClaimRequired: false,
            storeClaimUpdatedAt: now,
            storeClaimUpdatedBy: actorId,
            activeSeatInstallId: "",
            seatClaimedAt: 0,
          },
          { merge: true },
        );
      return { ok: true, action, actorId, at: now, storeClaimRequired: false };
    }

    if (action === "get_store_claim") {
      const policy = await loadStoreClaimPolicy(getFirestore());
      return {
        ok: true,
        action,
        storeClaimRequired: policy.required,
        storeClaimRejectDev: policy.rejectDev,
        storeClaimUpdatedAt: policy.updatedAt,
        hasCode: policy.hash.length >= 32,
        seatMode: policy.seatMode,
        activeSeatInstallId: policy.activeSeatInstallId || "",
      };
    }

    const deviceId = asString(data?.deviceId, 64);
    if (!deviceId || deviceId.length < 8 || !/^[a-zA-Z0-9_-]+$/.test(deviceId)) {
      throw new functions.https.HttpsError("invalid-argument", "deviceId ไม่ถูกต้อง");
    }
    const db = getFirestore();
    const ref = db.collection(COL).doc(deviceId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new functions.https.HttpsError("not-found", "ไม่พบเครื่องนี้ในระบบ");
    }

    const now = Date.now();

    if (action === "clear_captures") {
      const result = await clearNposShotsForInstall(deviceId);
      return { ok: true, deviceId, action, actorId, at: now, ...result };
    }

    let patch = { updatedAt: now, updatedBy: actorId };

    if (action === "capture") {
      patch.captureRequestAt = now;
    } else if (action === "capture_interval") {
      const allowed = new Set([0, 5, 10, 30]);
      const mins = Number(data?.intervalMinutes);
      const intervalMinutes = allowed.has(mins) ? mins : 0;
      patch.captureIntervalMinutes = intervalMinutes;
    } else if (action === "block") {
      const policy = await loadStoreClaimPolicy(db);
      if (policy.activeSeatInstallId === deviceId) {
        await db.doc(META_POS).set(
          { activeSeatInstallId: "", seatClaimedAt: 0, updatedAt: now },
          { merge: true },
        );
      }
      patch = {
        ...patch,
        blocked: true,
        disabled: true,
        deviceClass: "blocked",
        storeClaimed: false,
        storeClaimMethod: "revoked",
        storeClaimRevokeReason: "blocked",
        storeClaimRevokedAt: now,
      };
    } else if (action === "unblock") {
      const isEmulator = data?.isEmulator === true || snap.get("isEmulator") === true;
      patch = {
        ...patch,
        blocked: false,
        disabled: false,
        deviceClass: isEmulator ? "dev" : "shop",
      };
    } else if (action === "grant_claim") {
      // Owner grants exclusive seat to this device (kicks previous holder).
      const policy = await loadStoreClaimPolicy(db);
      await db.doc(META_POS).set(
        {
          activeSeatInstallId: deviceId,
          seatMode: policy.seatMode === "multi" ? "multi" : "exclusive",
          seatClaimedAt: now,
          updatedAt: now,
        },
        { merge: true },
      );
      if (policy.seatMode !== "multi" && policy.activeSeatInstallId && policy.activeSeatInstallId !== deviceId) {
        await db
          .collection(COL)
          .doc(policy.activeSeatInstallId)
          .set(
            {
              storeClaimed: false,
              storeClaimRevokedAt: now,
              storeClaimMethod: "revoked",
              storeClaimRevokeReason: "kicked",
              updatedAt: now,
            },
            { merge: true },
          );
      }
      patch = {
        ...patch,
        storeClaimed: true,
        storeClaimedAt: now,
        storeClaimMethod: "owner",
        storeClaimRevokeReason: "",
        blocked: false,
        disabled: false,
        deviceClass:
          snap.get("isEmulator") === true || data?.isEmulator === true ? "dev" : "shop",
      };
    } else if (action === "revoke_claim") {
      const policy = await loadStoreClaimPolicy(db);
      if (policy.activeSeatInstallId === deviceId) {
        await db.doc(META_POS).set(
          {
            activeSeatInstallId: "",
            seatClaimedAt: 0,
            updatedAt: now,
          },
          { merge: true },
        );
      }
      patch = {
        ...patch,
        storeClaimed: false,
        storeClaimRevokedAt: now,
        storeClaimMethod: "revoked",
        storeClaimRevokeReason: "kicked",
      };
    } else {
      throw new functions.https.HttpsError("invalid-argument", "action ไม่รู้จัก");
    }

    await ref.set(patch, { merge: true });
    return { ok: true, deviceId, action, at: now };
  });
