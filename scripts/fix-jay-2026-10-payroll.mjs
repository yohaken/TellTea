/**
 * One-shot: จัดเงินเดือน JAY 2026-10 ให้เป็นมาตรฐานเดียวกับเพื่อน
 *
 * ก่อนแก้:
 *  - 10/10 เบิก 500 ถูกบันทึกเป็น "จ่ายแยก" (salary_special) → ไม่เข้า advanceBalance + ติ๊กข้ามรอบกลุ่ม
 *  - 15/10 สร้างเงินเดือนกลุ่มข้าม JAY → โอนกลางเดือน 6000 ถูกบันทึกเป็น "เบิกล่วงหน้า" (advanceBalance = 6000)
 *
 * หลังแก้:
 *  - salary_mid 2026-10 = 6000 จ่ายแล้ว (สลิป + แถวสมุดเดิม เปลี่ยนชื่อเป็นเงินเดือนงวดกลาง)
 *  - advanceBalance = 500 (เบิก 10/10)
 *  - salary_month_end 2026-10 = 6000 หักเบิก 500 → โอน 5500 (รอโอน)
 *  - แถวจ่ายแยก 500 คงไว้ (เงินออกจริง) → รวมทั้งเดือน 500 + 6000 + 5500 = 12000
 *
 *   node scripts/fix-jay-2026-10-payroll.mjs            — dry-run
 *   APPLY=1 node scripts/fix-jay-2026-10-payroll.mjs    — เขียนจริง
 *
 * ใช้ FIREBASE_SERVICE_ACCOUNT หรือ gcloud application-default credentials
 */
import { initializeApp, cert, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT = process.env.FIREBASE_PROJECT_ID || "mypeer-501909";
const APPLY = process.env.APPLY === "1" || process.env.APPLY === "true";

const EMP_ID = "5vvygErETiMNLMtYoKel";
const EMP_NAME = "JAY";
const PERIOD = "2026-10";
const MONTHLY = 12000;
const HALF = 6000;
const ADVANCE_500 = 500;
const OWNER = "yohaken@gmail.com";

const ADVANCE_BOOK_ID = "UP3mRuFMyfZWVf7OzHwe";
const SPECIAL_ID = `${EMP_ID}_${PERIOD}_salary_special_mv1sbhk5`;
const MID_ID = `${EMP_ID}_${PERIOD}_salary_mid`;
const END_ID = `${EMP_ID}_${PERIOD}_salary_month_end`;

// เหมือนแถวงวดเดียวกันของเพื่อน (2026-10)
const MID_DUE = 1792040400000;
const END_DUE = 1793509200000;
const END_ACCOUNT = 1793422800000;

function getDb() {
  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_KEY;
    const credential =
      raw && raw.trim().startsWith("{") ? cert(JSON.parse(raw)) : applicationDefault();
    initializeApp({ credential, projectId: PROJECT });
  }
  return getFirestore();
}

function fail(msg) {
  console.error(`STOP: ${msg}`);
  process.exit(1);
}

async function main() {
  const db = getDb();
  const payRef = db.collection("employeePay").doc(EMP_ID);
  const bookRef = db.collection("ownerBooks").doc(ADVANCE_BOOK_ID);
  const specialRef = db.collection("payrollItems").doc(SPECIAL_ID);
  const midRef = db.collection("payrollItems").doc(MID_ID);
  const endRef = db.collection("payrollItems").doc(END_ID);

  const [pay, book, special, mid, end] = await Promise.all([
    payRef.get(),
    bookRef.get(),
    specialRef.get(),
    midRef.get(),
    endRef.get(),
  ]);

  const payData = pay.data() || {};
  const bookData = book.data() || {};
  const specialData = special.data() || {};

  if (Number(payData.monthlySalary) !== MONTHLY) fail(`monthlySalary = ${payData.monthlySalary}`);
  if (Number(payData.advanceBalance) !== HALF) fail(`advanceBalance = ${payData.advanceBalance} (คาด ${HALF})`);
  if (payData.skipGroupPayroll === true) fail("ยังติ๊กข้ามรอบกลุ่มอยู่");
  if (!book.exists) fail("ไม่พบแถวสมุดเบิกล่วงหน้า 6000");
  if (bookData.typeSource !== "payroll-advance" || Number(bookData.amountOut) !== HALF) {
    fail(`แถวสมุด ${ADVANCE_BOOK_ID} ไม่ใช่เบิก 6000 แล้ว (${bookData.typeSource} ฿${bookData.amountOut})`);
  }
  if (!special.exists || specialData.status !== "paid" || Number(specialData.amount) !== ADVANCE_500) {
    fail("แถวจ่ายแยก 500 ไม่ตรงที่ตรวจไว้");
  }
  if (mid.exists) fail(`${MID_ID} มีอยู่แล้ว (status=${mid.data()?.status})`);
  if (end.exists) fail(`${END_ID} มีอยู่แล้ว (status=${end.data()?.status}) — ลบ/ยกเลิกก่อน หรือแก้สคริปต์`);

  const slipUrls = Array.isArray(bookData.receiptUrls) ? bookData.receiptUrls : [];
  if (!slipUrls.length) fail("แถวสมุดเบิก 6000 ไม่มีสลิป");
  const paidAt = Number(bookData.createdAt) || Date.now();
  const now = Date.now();

  const midDoc = {
    employeeId: EMP_ID,
    employeeName: EMP_NAME,
    periodMonth: PERIOD,
    kind: "salary_mid",
    dueDate: MID_DUE,
    accountDate: MID_DUE,
    grossAmount: HALF,
    advanceDeduct: 0,
    amount: HALF,
    note: "",
    salaryBase: MONTHLY,
    bonusRemaining: 0,
    combinedPayId: "",
    createdBy: OWNER,
    createdAt: paidAt,
    slipUrls,
    advanceApplied: true,
    paidBy: OWNER,
    ownerBookId: ADVANCE_BOOK_ID,
    paidAt,
    status: "paid",
    updatedAt: now,
  };

  const endAmount = HALF - ADVANCE_500;
  const endDoc = {
    employeeId: EMP_ID,
    employeeName: EMP_NAME,
    periodMonth: PERIOD,
    kind: "salary_month_end",
    dueDate: END_DUE,
    accountDate: END_ACCOUNT,
    grossAmount: HALF,
    advanceDeduct: ADVANCE_500,
    amount: endAmount,
    status: "pending",
    slipUrls: [],
    note: `หักเบิก ฿${ADVANCE_500.toFixed(2)}`,
    paidAt: 0,
    paidBy: "",
    ownerBookId: "",
    salaryBase: MONTHLY,
    bonusRemaining: 0,
    advanceApplied: false,
    combinedPayId: "",
    updatedAt: now,
    createdBy: OWNER,
    createdAt: now,
  };

  const bookPatch = {
    description: `เงินเดือนงวดกลาง ${PERIOD} — ${EMP_NAME}`,
    typeSource: "payroll",
    typeAiReason: "เงินเดือนพนักงาน",
    note: "",
    updatedAt: now,
  };

  const payPatch = { advanceBalance: ADVANCE_500, updatedAt: now };

  console.log("Plan:");
  console.log(` + create ${MID_ID}: paid ฿${HALF} · slip ${slipUrls.join(",")} · book ${ADVANCE_BOOK_ID}`);
  console.log(` ~ ownerBooks/${ADVANCE_BOOK_ID}: "${bookData.description}" → "${bookPatch.description}" · payroll-advance → payroll`);
  console.log(` ~ employeePay/${EMP_ID}.advanceBalance: ${payData.advanceBalance} → ${ADVANCE_500}`);
  console.log(` + create ${END_ID}: pending ฿${HALF} − เบิก ฿${ADVANCE_500} = โอน ฿${endAmount}`);
  console.log(`   keep ${SPECIAL_ID}: จ่ายแยก ฿${ADVANCE_500} (เบิก 10/10)`);
  console.log(` = รวมเดือน ${PERIOD}: ${ADVANCE_500} + ${HALF} + ${endAmount} = ${ADVANCE_500 + HALF + endAmount}`);

  if (!APPLY) {
    console.log("Dry-run only. Re-run with APPLY=1 to write.");
    return;
  }

  await db.runTransaction(async (tx) => {
    const [p, m, e] = await Promise.all([tx.get(payRef), tx.get(midRef), tx.get(endRef)]);
    if (Number(p.data()?.advanceBalance) !== HALF) throw new Error("advanceBalance เปลี่ยนระหว่างรัน");
    if (m.exists || e.exists) throw new Error("แถวเงินเดือนถูกสร้างระหว่างรัน");
    tx.create(midRef, midDoc);
    tx.create(endRef, endDoc);
    tx.update(bookRef, bookPatch);
    tx.set(payRef, payPatch, { merge: true });
  });

  console.log("OK applied");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
