/**
 * โหลด input สรุปโบนัสสำหรับพนักงานผ่าน Admin SDK — กัน client rules emergency
 * ที่ list otEntries/prodEntries ไม่ผ่านแม้สิทธิ์ level ถูกต้อง
 */
const functions = require("firebase-functions/v1");
const { getFirestore } = require("firebase-admin/firestore");
const { _findStaffId, _mapStaffPayload } = require("./resolve-my-staff");

const REGION = "asia-southeast1";

function bangkokMonthRangeMs(year, monthIdx) {
  const m = Math.max(0, Math.min(11, Math.floor(monthIdx)));
  const y = Math.floor(year);
  const startKey = `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const nextY = m === 11 ? y + 1 : y;
  const nextM = m === 11 ? 1 : m + 2;
  const endKey = `${nextY}-${String(nextM).padStart(2, "0")}-01`;
  return {
    since: Date.parse(`${startKey}T00:00:00+07:00`),
    until: Date.parse(`${endKey}T00:00:00+07:00`),
  };
}

function permFromLevel(staffData, levelDoc) {
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
    const fromLevel = permFromLevel(staffData, levelDoc);
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

function mapEmployee(id, data) {
  const d = data || {};
  return {
    id,
    name: String(d.name || "").trim(),
    nickname: d.nickname ? String(d.nickname) : undefined,
    active: d.active !== false,
    linkedStaffId: d.linkedStaffId ? String(d.linkedStaffId) : undefined,
    linkedEmail: d.linkedEmail ? String(d.linkedEmail) : undefined,
    linkedPhone: d.linkedPhone ? String(d.linkedPhone) : undefined,
    createdAt: Number(d.createdAt) || 0,
    updatedAt: Number(d.updatedAt) || 0,
  };
}

function docWithId(doc) {
  return { id: doc.id, ...doc.data() };
}

exports.loadStaffBonusBundle = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "ต้องล็อกอินก่อน");
    }
    const month = String(data?.month || "").trim();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new functions.https.HttpsError("invalid-argument", "เดือนไม่ถูกต้อง");
    }
    const year = Number(month.slice(0, 4));
    const monthIdx = Number(month.slice(5, 7)) - 1;
    if (!Number.isFinite(year) || monthIdx < 0 || monthIdx > 11) {
      throw new functions.https.HttpsError("invalid-argument", "เดือนไม่ถูกต้อง");
    }

    const db = getFirestore();
    const authToken = context.auth.token || {};
    const email = String(authToken.email || "").trim().toLowerCase();
    const phone = String(authToken.phone_number || "").trim();
    const claimStaffId = String(authToken.staffId || "").trim();

    const staffIdRaw = await _findStaffId(db, email, phone);
    let staffId = staffIdRaw;
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
    const levelDoc = levelId ? await db.collection("permissionLevels").doc(levelId).get() : null;

    if (!staffHasPerm(staffData, levelDoc, "bonus")) {
      throw new functions.https.HttpsError("permission-denied", "สิทธิ์โบนัสไม่พอ");
    }

    const employeeId = String(staffData.employeeId || "").trim();
    if (!employeeId) {
      throw new functions.https.HttpsError("failed-precondition", "บัญชียังไม่ผูกกับรายชื่อร้าน");
    }

    const linkedSnap = await db.collection("employees").doc(employeeId).get();
    if (!linkedSnap.exists || linkedSnap.get("active") === false) {
      throw new functions.https.HttpsError("failed-precondition", "ไม่พบรายชื่อที่ผูกไว้");
    }

    const { since, until } = bangkokMonthRangeMs(year, monthIdx);

    const [
      employeesSnap,
      rateSnap,
      deductionSettingsSnap,
      deductionMonthSnap,
      otSnap,
      prodSnap,
      livePoolSnap,
      monthStatusSnap,
      personalCloseSnap,
    ] = await Promise.all([
      db.collection("employees").where("active", "==", true).orderBy("name", "asc").get(),
      db.doc("meta/rateSchedule").get(),
      db.doc("meta/bonusDeductionSettings").get(),
      db.doc(`bonusDeductionMonths/${month}`).get(),
      db
        .collection("otEntries")
        .where("date", ">=", since)
        .where("date", "<", until)
        .orderBy("date", "desc")
        .orderBy("createdAt", "desc")
        .get(),
      db
        .collection("prodEntries")
        .where("date", ">=", since)
        .where("date", "<", until)
        .orderBy("date", "desc")
        .orderBy("createdAt", "desc")
        .get(),
      db.doc(`bonusLivePool/${month}`).get(),
      db.doc(`bonusMonthStatus/${month}`).get(),
      db.doc(`bonusPersonalCloses/${month}_${employeeId}`).get(),
    ]);

    const employees = employeesSnap.docs.map((d) => mapEmployee(d.id, d.data()));
    const linked = mapEmployee(linkedSnap.id, linkedSnap.data());

    return {
      ok: true,
      staff: _mapStaffPayload(staffId, staffData),
      bundle: {
        linked,
        employees,
        rateSchedule: Array.isArray(rateSnap.get("entries")) ? rateSnap.get("entries") : [],
        deductionSettings: deductionSettingsSnap.exists ? deductionSettingsSnap.data() : null,
        deductionMonth: deductionMonthSnap.exists ? deductionMonthSnap.data() : null,
        otEntries: otSnap.docs.map(docWithId),
        prodEntries: prodSnap.docs.map(docWithId),
        livePool: livePoolSnap.exists ? livePoolSnap.data() : null,
        monthStatus: monthStatusSnap.exists ? monthStatusSnap.data() : null,
        personalClose: personalCloseSnap.exists ? personalCloseSnap.data() : null,
      },
    };
  });
