/**
 * แลกตั๋วล็อกอิน Google (loginTickets) ด้วย Admin SDK —
 * ไม่พึ่ง Firestore rules / IndexedDB ฝั่ง client ที่เคยทำให้ล็อกอินค้าง
 */
const functions = require("firebase-functions/v1");
const { getFirestore } = require("firebase-admin/firestore");

function asTicketId(raw) {
  const t = typeof raw === "string" ? raw.trim() : "";
  if (!t || t.length < 16 || t.length > 128) return "";
  if (!/^[a-f0-9]+$/i.test(t)) return "";
  return t;
}

exports.exchangeLoginTicket = functions
  .region("asia-southeast1")
  .https.onCall(async (data) => {
    const ticket = asTicketId(data?.ticket);
    if (!ticket) {
      throw new functions.https.HttpsError("invalid-argument", "ตั๋วล็อกอินไม่ถูกต้อง");
    }
    const ref = getFirestore().collection("loginTickets").doc(ticket);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new functions.https.HttpsError(
        "not-found",
        "ลิงก์ล็อกอินหมดอายุหรือใช้แล้ว — กดเข้าสู่ระบบอีกครั้ง",
      );
    }
    const body = snap.data() || {};
    // ใช้แล้วทิ้ง — กันใช้ซ้ำ
    await ref.delete().catch(() => undefined);

    const idToken = typeof body.idToken === "string" ? body.idToken : "";
    if (idToken.length < 20 || idToken.length > 12000) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "ตั๋วล็อกอินเสีย — กดเข้าสู่ระบบอีกครั้ง",
      );
    }
    const exp = typeof body.exp === "number" ? body.exp : 0;
    if (exp > 0 && exp < Date.now()) {
      throw new functions.https.HttpsError(
        "deadline-exceeded",
        "ลิงก์ล็อกอินหมดอายุ — กดเข้าสู่ระบบอีกครั้ง",
      );
    }
    return { idToken };
  });
