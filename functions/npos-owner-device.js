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
  META_POS_CLAIM_SECRET,
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

function isDevOrEmulatorDoc(data) {
  if (!data || typeof data !== "object") return false;
  if (data.isEmulator === true) return true;
  if (data.deviceClass === "dev") return true;
  const hint = typeof data.deviceHint === "string" ? data.deviceHint : "";
  return /sdk|emulator|generic|goldfish|ranchu/i.test(hint);
}

/**
 * Keep only live shop tablets. Everything else (emu/dev/orphan) is test noise
 * to wipe from sessions/sales after early AVD testing.
 */
function shouldPurgeDeviceId(deviceId, purgeIds, shopKeepIds) {
  const id = asString(deviceId, 64);
  if (!id) return true;
  if (shopKeepIds.has(id)) return false;
  if (purgeIds.has(id)) return true;
  // Orphaned install from deleted emulator / unknown non-shop.
  return true;
}

exports.nposOwnerDeviceCommand = functions
  .region("asia-southeast1")
  .runWith({ memory: "1GB", timeoutSeconds: 540 })
  .https.onCall(async (data, context) => {
    const { actorId } = await assertOwner(context);
    const action = asString(data?.action, 32).toLowerCase();

    // Shop-wide clear — no deviceId required.
    if (action === "clear_captures_all") {
      const result = await clearAllNposShots();
      return { ok: true, action, actorId, at: Date.now(), ...result };
    }

    // Purge emulator/dev tech docs + their sessions/sales/logs — start shop clean.
    if (action === "purge_dev_devices") {
      const db = getFirestore();
      const now = Date.now();

      const devicesSnap = await db.collection(COL).get();
      const purgeIds = new Set();
      const shopKeepIds = new Set();
      for (const docSnap of devicesSnap.docs) {
        const data = docSnap.data() || {};
        if (isDevOrEmulatorDoc(data)) purgeIds.add(docSnap.id);
        else shopKeepIds.add(docSnap.id);
      }

      const [diagSnap, opsSnap, sessionsSnap, salesSnap, mutationsSnap, shotsSnap] =
        await Promise.all([
          db.collection("nposDiagnose").get(),
          db.collection("nposOpsLog").get(),
          db.collection("posSessions").get(),
          db.collection("posSales").get(),
          db.collection("posSaleMutations").get(),
          db.collection("nposScreenShots").get(),
        ]);

      for (const docSnap of [...diagSnap.docs, ...opsSnap.docs]) {
        if (isDevOrEmulatorDoc(docSnap.data() || {})) purgeIds.add(docSnap.id);
      }

      const deviceRefs = [];
      for (const id of purgeIds) {
        if (devicesSnap.docs.some((d) => d.id === id)) {
          deviceRefs.push(db.collection(COL).doc(id));
        }
      }

      const diagnoseRefs = [];
      const opsRefs = [];
      for (const docSnap of diagSnap.docs) {
        if (purgeIds.has(docSnap.id) || isDevOrEmulatorDoc(docSnap.data() || {})) {
          diagnoseRefs.push(docSnap.ref);
          purgeIds.add(docSnap.id);
        }
      }
      for (const docSnap of opsSnap.docs) {
        if (purgeIds.has(docSnap.id) || isDevOrEmulatorDoc(docSnap.data() || {})) {
          opsRefs.push(docSnap.ref);
          purgeIds.add(docSnap.id);
        }
      }

      const sessionRefs = [];
      for (const docSnap of sessionsSnap.docs) {
        const data = docSnap.data() || {};
        if (shouldPurgeDeviceId(data.deviceId, purgeIds, shopKeepIds)) {
          sessionRefs.push(docSnap.ref);
        }
      }

      const saleRefs = [];
      for (const docSnap of salesSnap.docs) {
        const data = docSnap.data() || {};
        if (shouldPurgeDeviceId(data.deviceId, purgeIds, shopKeepIds)) {
          saleRefs.push(docSnap.ref);
        }
      }

      const mutationRefs = [];
      for (const docSnap of mutationsSnap.docs) {
        const data = docSnap.data() || {};
        if (shouldPurgeDeviceId(data.deviceId, purgeIds, shopKeepIds)) {
          mutationRefs.push(docSnap.ref);
        }
      }

      const shotRefs = [];
      for (const docSnap of shotsSnap.docs) {
        const data = docSnap.data() || {};
        const installId = asString(data.installId, 64);
        if (purgeIds.has(installId) || shouldPurgeDeviceId(installId, purgeIds, shopKeepIds)) {
          shotRefs.push(docSnap.ref);
        }
      }

      const deletedDevices = await commitDeletes(db, deviceRefs);
      const deletedDiagnose = await commitDeletes(db, diagnoseRefs);
      const deletedOps = await commitDeletes(db, opsRefs);
      const deletedSessions = await commitDeletes(db, sessionRefs);
      const deletedSales = await commitDeletes(db, saleRefs);
      const deletedMutations = await commitDeletes(db, mutationRefs);
      const deletedShots = await commitDeletes(db, shotRefs);

      // Clear bestseller cache so BO "เมนูขายดี" doesn't show emu noise.
      await db.doc("meta/posMenuRank").set(
        {
          items: [],
          categories: [],
          updatedAt: now,
          purgedBy: actorId,
          purgedReason: "purge_dev_devices",
        },
        { merge: true },
      );

      return {
        ok: true,
        action,
        actorId,
        at: now,
        deletedDevices,
        deletedDiagnose,
        deletedOps,
        deletedSessions,
        deletedSales,
        deletedMutations,
        deletedShots,
        shopKept: shopKeepIds.size,
        purgedIds: [...purgeIds].slice(0, 40),
      };
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
      // Owner-only secret doc — full code for BO recall (not on meta/pos).
      batch.set(
        db.doc(META_POS_CLAIM_SECRET),
        {
          storeClaimCode: code,
          updatedAt: now,
          updatedBy: actorId,
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
      const db = getFirestore();
      const batch = db.batch();
      batch.set(
        db.doc(META_POS),
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
      batch.set(
        db.doc(META_POS_CLAIM_SECRET),
        {
          storeClaimCode: "",
          updatedAt: now,
          updatedBy: actorId,
        },
        { merge: true },
      );
      await batch.commit();
      return { ok: true, action, actorId, at: now, storeClaimRequired: false };
    }

    if (action === "get_store_claim") {
      const db = getFirestore();
      const policy = await loadStoreClaimPolicy(db);
      const secretSnap = await db.doc(META_POS_CLAIM_SECRET).get();
      const secret = secretSnap.exists ? secretSnap.data() || {} : {};
      const storeClaimCode =
        typeof secret.storeClaimCode === "string"
          ? String(secret.storeClaimCode).trim().toUpperCase()
          : "";
      return {
        ok: true,
        action,
        storeClaimRequired: policy.required,
        storeClaimRejectDev: policy.rejectDev,
        storeClaimUpdatedAt: policy.updatedAt,
        hasCode: policy.hash.length >= 32,
        seatMode: policy.seatMode,
        activeSeatInstallId: policy.activeSeatInstallId || "",
        // Full code for owner BO only (CF assertOwner). Empty if set before this field existed.
        storeClaimCode: storeClaimCode.length >= 4 ? storeClaimCode : "",
      };
    }

    // Clear exclusive seat + revoke every claimed tablet — fresh login.
    if (action === "clear_seat") {
      const now = Date.now();
      const db = getFirestore();
      const claimed = await db.collection(COL).where("storeClaimed", "==", true).get();
      const batch = db.batch();
      batch.set(
        db.doc(META_POS),
        {
          activeSeatInstallId: "",
          seatClaimedAt: 0,
          updatedAt: now,
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
            storeClaimRevokeReason: "kicked",
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
        activeSeatInstallId: "",
        revokedCount: claimed.size,
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
