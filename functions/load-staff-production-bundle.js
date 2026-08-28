/**
 * โหลด input หน้าผลิตสำหรับพนักงานผ่าน Admin SDK — กัน rules บล็อก list prodEntries
 */
const functions = require("firebase-functions/v1");
const { getFirestore } = require("firebase-admin/firestore");
const { _findStaffId } = require("./resolve-my-staff");

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

exports.loadStaffProductionBundle = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "ต้องล็อกอินก่อน");
    }
    const year = Number(data?.year);
    const monthIdx = Number(data?.monthIdx);
    if (!Number.isFinite(year) || !Number.isFinite(monthIdx) || monthIdx < 0 || monthIdx > 11) {
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
    const employeeId = String(staffData.employeeId || "").trim();
    if (!employeeId) {
      throw new functions.https.HttpsError("failed-precondition", "บัญชียังไม่ผูกกับรายชื่อร้าน");
    }

    const linkedSnap = await db.collection("employees").doc(employeeId).get();
    if (!linkedSnap.exists || linkedSnap.get("active") === false) {
      throw new functions.https.HttpsError("failed-precondition", "ไม่พบรายชื่อที่ผูกไว้");
    }

    const { since, until } = bangkokMonthRangeMs(year, monthIdx);

    const [employeesSnap, productsSnap, rateSnap, prodSnap] = await Promise.all([
      db.collection("employees").where("active", "==", true).orderBy("name", "asc").get(),
      db.collection("prodProducts").orderBy("name", "asc").get(),
      db.doc("meta/rateSchedule").get(),
      db
        .collection("prodEntries")
        .where("date", ">=", since)
        .where("date", "<", until)
        .orderBy("date", "desc")
        .orderBy("createdAt", "desc")
        .get(),
    ]);

    const workers = employeesSnap.docs.map((d) => mapEmployee(d.id, d.data()));
    const linked = mapEmployee(linkedSnap.id, linkedSnap.data());

    return {
      ok: true,
      bundle: {
        linked,
        workers,
        products: productsSnap.docs.map(docWithId),
        rateSchedule: Array.isArray(rateSnap.get("entries")) ? rateSnap.get("entries") : [],
        prodEntries: prodSnap.docs.map(docWithId),
      },
    };
  });
