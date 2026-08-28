/**
 * โหลดบัญชีสำหรับพนักงานผ่าน Admin SDK — กัน live rules ที่ hasPerm() ไม่ทำงาน
 */
const functions = require("firebase-functions/v1");
const { getFirestore } = require("firebase-admin/firestore");
const { _findStaffId } = require("./resolve-my-staff");

const REGION = "asia-southeast1";
const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 480;

function permFromLevel(levelDoc) {
  if (!levelDoc?.exists) return null;
  const data = levelDoc.data() || {};
  if (data.active === false) return null;
  return data.permissions && typeof data.permissions === "object" ? data.permissions : null;
}

function staffHasPerm(staffData, levelDoc, key) {
  if (staffData.role === "owner") return true;
  const customized = staffData.permissionsCustomized === true;
  const levelId = String(staffData.permissionLevelId || "").trim();
  if (levelId && !customized) {
    const fromLevel = permFromLevel(levelDoc);
    if (fromLevel && fromLevel[key] === true) return true;
    if (fromLevel) return false;
  }
  if (staffData.permissions && typeof staffData.permissions === "object") {
    return staffData.permissions[key] === true;
  }
  if (!levelId && !staffData.permissions) {
    return key === "production" || key === "otBonus" || key === "checklist" || key === "bonus";
  }
  return false;
}

function docWithId(doc) {
  return { id: doc.id, ...doc.data() };
}

exports.loadStaffLedgerBundle = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "ต้องล็อกอินก่อน");
    }

    const limitCount = Math.max(
      1,
      Math.min(MAX_LIMIT, Number(data?.limit) || DEFAULT_LIMIT),
    );

    const db = getFirestore();
    const authToken = context.auth.token || {};
    const email = String(authToken.email || "").trim().toLowerCase();
    const phone = String(authToken.phone_number || "").trim();
    const claimStaffId = String(authToken.staffId || "").trim();

    let staffId = await _findStaffId(db, email, phone);
    if (!staffId && claimStaffId) {
      const claimSnap = await db.collection("staff").doc(claimStaffId).get();
      if (claimSnap.exists) staffId = claimStaffId;
    }
    if (!staffId) {
      throw new functions.https.HttpsError("permission-denied", "ไม่พบบัญชีพนักงาน");
    }

    const staffSnap = await db.collection("staff").doc(staffId).get();
    if (!staffSnap.exists) {
      throw new functions.https.HttpsError("permission-denied", "ไม่พบบัญชีพนักงาน");
    }
    const staffData = staffSnap.data() || {};
    const levelId = String(staffData.permissionLevelId || "").trim();
    const levelSnap = levelId
      ? await db.collection("permissionLevels").doc(levelId).get()
      : null;
    if (!staffHasPerm(staffData, levelSnap, "ledger")) {
      throw new functions.https.HttpsError("permission-denied", "สิทธิ์บัญชีไม่พอ");
    }

    const [metaSnap, ledgerSnap] = await Promise.all([
      db.doc("meta/ledger").get(),
      db
        .collection("ledger")
        .orderBy("date", "desc")
        .orderBy("createdAt", "desc")
        .limit(limitCount)
        .get(),
    ]);

    const meta = metaSnap.exists ? metaSnap.data() || {} : {};
    const balance = Number(meta.balance);
    const entries = ledgerSnap.docs.map(docWithId);

    return {
      ok: true,
      bundle: {
        balance: Number.isFinite(balance) ? balance : null,
        totalIn: Number(meta.totalIn) || 0,
        totalOut: Number(meta.totalOut) || 0,
        entries,
        hasMore: entries.length >= limitCount,
      },
    };
  });
