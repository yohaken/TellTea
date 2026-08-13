const functions = require("firebase-functions/v1");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const webpush = require("web-push");
const { runSyncWithAdmin } = require("./task-weekly-sync");
const { completePosSaleAdmin, isPosCaller } = require("./pos-complete-sale");
const evidenceUpload = require("./evidence-upload");
const classifyLedger = require("./classify-ledger");
const extractOwnerBook = require("./extract-owner-book");
const extractCashDeposit = require("./extract-cash-deposit");

initializeApp();

exports.createEvidenceUpload = evidenceUpload.createEvidenceUpload;
exports.finalizeEvidenceUpload = evidenceUpload.finalizeEvidenceUpload;
exports.uploadEvidencePhoto = evidenceUpload.uploadEvidencePhoto;
exports.classifyLedgerType = classifyLedger.classifyLedgerType;
exports.extractOwnerBookFromReceipt = extractOwnerBook.extractOwnerBookFromReceipt;
exports.extractCashDepositSlip = extractCashDeposit.extractCashDepositSlip;
exports.reportNposDiagnose = require("./npos-diagnose").reportNposDiagnose;
exports.nposDeviceHeartbeat = require("./npos-heartbeat").nposDeviceHeartbeat;
exports.reportNposOpsLog = require("./npos-ops-log").reportNposOpsLog;
exports.reportNposScreenCapture = require("./npos-capture").reportNposScreenCapture;
exports.nposCaptureMedia = require("./npos-capture-media").nposCaptureMedia;
exports.nposOwnerDeviceCommand = require("./npos-owner-device").nposOwnerDeviceCommand;
exports.nposClaimDevice = require("./npos-claim-device").nposClaimDevice;
const nposSell = require("./npos-sell");
exports.nposMenuSnapshot = nposSell.nposMenuSnapshot;
exports.nposShopSettings = nposSell.nposShopSettings;
exports.nposSessionOpen = nposSell.nposSessionOpen;
exports.nposSessionClose = nposSell.nposSessionClose;
exports.nposCompleteSale = nposSell.nposCompleteSale;
exports.nposVoidSale = nposSell.nposVoidSale;
exports.nposToggleSoldOut = nposSell.nposToggleSoldOut;
exports.nposReorderCategories = nposSell.nposReorderCategories;
exports.nposMemberLookup = nposSell.nposMemberLookup;
exports.nposMemberQuickCreate = nposSell.nposMemberQuickCreate;
exports.nposCompCouponStatus = nposSell.nposCompCouponStatus;
exports.nposIssueCompCoupon = nposSell.nposIssueCompCoupon;
exports.publicMemberSignup = nposSell.publicMemberSignup;
exports.publicReceiptClaimPreview = nposSell.publicReceiptClaimPreview;
exports.publicReceiptClaimLookup = nposSell.publicReceiptClaimLookup;
exports.publicReceiptClaim = nposSell.publicReceiptClaim;
exports.publicMemberMe = nposSell.publicMemberMe;
exports.publicSpinGameCredit = nposSell.publicSpinGameCredit;
exports.publicCompCouponPreview = nposSell.publicCompCouponPreview;
exports.publicCompCouponLookup = nposSell.publicCompCouponLookup;
exports.publicCompCouponClaim = nposSell.publicCompCouponClaim;
const nposMenuAdmin = require("./npos-menu-admin");
exports.nposMenuAdminSnapshot = nposMenuAdmin.nposMenuAdminSnapshot;
exports.nposMenuMutate = nposMenuAdmin.nposMenuMutate;
const posMenuRank = require("./pos-menu-rank");
exports.posRecomputeMenuRank = posMenuRank.posRecomputeMenuRank;
exports.posMenuRankDaily = posMenuRank.posMenuRankDaily;
const vatMail = require("./vat-mail");
exports.vatMailStatus = vatMail.vatMailStatus;
exports.vatMailOAuthStart = vatMail.vatMailOAuthStart;
exports.vatMailOAuthCallback = vatMail.vatMailOAuthCallback;
exports.vatMailDisconnect = vatMail.vatMailDisconnect;
exports.vatMailSync = vatMail.vatMailSync;
exports.vatMailPdfUrl = vatMail.vatMailPdfUrl;
const vatMailDrive = require("./vat-mail-drive");
exports.vatMailDriveSync = vatMailDrive.vatMailDriveSync;
const vatDeliveryCaptureExtract = require("./vat-delivery-capture-extract");
exports.vatDeliveryCaptureExtract =
  vatDeliveryCaptureExtract.vatDeliveryCaptureExtract;
const vatMailAgentDump = require("./vat-mail-agent-dump");
exports.vatMailAgentDump = vatMailAgentDump.vatMailAgentDump;
const vatMailAgentPropose = require("./vat-mail-agent-propose");
exports.vatMailAgentPropose = vatMailAgentPropose.vatMailAgentPropose;
const vatMailAiPeriod = require("./vat-mail-ai-period");
exports.vatMailAiClassifyPeriod = vatMailAiPeriod.vatMailAiClassifyPeriod;
const vatOutlook = require("./vat-mail-outlook");
exports.vatOutlookStatus = vatOutlook.vatOutlookStatus;
exports.vatOutlookOAuthStart = vatOutlook.vatOutlookOAuthStart;
exports.vatOutlookOAuthCallback = vatOutlook.vatOutlookOAuthCallback;
exports.vatOutlookDisconnect = vatOutlook.vatOutlookDisconnect;
exports.vatOutlookSync = vatOutlook.vatOutlookSync;
const vatSalesAlerts = require("./vat-sales-alerts");
exports.vatSalesDailyAlert = vatSalesAlerts.vatSalesDailyAlert;
exports.vatSalesAlertCheck = vatSalesAlerts.vatSalesAlertCheck;
const ownerDailyDigest = require("./owner-daily-digest");
exports.ownerDailyDigestHourly = ownerDailyDigest.ownerDailyDigestHourly;
exports.ownerLineNotifyTest = ownerDailyDigest.ownerLineNotifyTest;
exports.ownerDailyDigestRunNow = ownerDailyDigest.ownerDailyDigestRunNow;
const staffPresence = require("./staff-presence");
exports.touchStaffPresence = staffPresence.touchStaffPresence;
exports.onOtEntryCreatedForPresence = staffPresence.onOtEntryCreatedForPresence;
exports.onProdEntryCreatedForPresence = staffPresence.onProdEntryCreatedForPresence;
exports.onStockCountWrittenForPresence = staffPresence.onStockCountWrittenForPresence;
const posWeather = require("./pos-weather");
exports.ensurePosWeatherDays = posWeather.ensurePosWeatherDays;
exports.posWeatherFinalizeDaily = posWeather.posWeatherFinalizeDaily;
const VAPID_PUBLIC =
  process.env.VAPID_PUBLIC_KEY ||
  "BI74S6JyDs61V0eqRuS9iy6XdhER9wtA-EXhLfWiEFZSeg2VBBQM1dnPnFsyVY2AQzcKF7gHZm-Eifpsc7cF0Zg";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || "";

const { evaluateAndSendLowBalanceLine } = require("./low-balance-line");
const { formatBaht } = require("./line-owner");

async function sendToOwnerSubscriptions(payload) {
  if (!VAPID_PRIVATE) {
    console.error("VAPID_PRIVATE_KEY missing — skip push");
    return { sent: 0, failed: 0 };
  }

  webpush.setVapidDetails("mailto:yohaken@gmail.com", VAPID_PUBLIC, VAPID_PRIVATE);

  const db = getFirestore();
  const snap = await db.collection("pushSubscriptions").where("role", "==", "owner").get();
  if (snap.empty) {
    console.log("No owner push subscriptions");
    return { sent: 0, failed: 0 };
  }

  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;

  await Promise.all(
    snap.docs.map(async (docSnap) => {
      const data = docSnap.data();
      const subscription = {
        endpoint: data.endpoint,
        keys: data.keys,
      };
      try {
        await webpush.sendNotification(subscription, body, { TTL: 60 * 60 });
        sent += 1;
      } catch (err) {
        failed += 1;
        console.warn("push failed", docSnap.id, err?.statusCode || err?.message);
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await docSnap.ref.delete().catch(() => undefined);
        }
      }
    }),
  );

  return { sent, failed };
}

exports.onLedgerBalanceWritten = functions
  .region("asia-southeast1")
  .firestore.document("meta/ledger")
  .onWrite(async (change) => {
    const after = change.after;
    if (!after.exists) return null;

    const balance = Number(after.data().balance);
    if (!Number.isFinite(balance)) return null;

    const result = await evaluateAndSendLowBalanceLine({ balance, force: false });
    console.log("low balance LINE", result);
    return null;
  });

/** Owner: check current balance vs threshold and send LINE now (for testing). */
exports.ownerLowBalanceLineCheck = functions
  .region("asia-southeast1")
  .https.onCall(async (data, context) => {
    if (!context.auth?.uid) {
      throw new functions.https.HttpsError("unauthenticated", "กรุณาเข้าสู่ระบบ");
    }
    const email = String(context.auth.token?.email || "").trim().toLowerCase();
    const db = getFirestore();
    let isOwner =
      email === String(process.env.TELLTEA_OWNER_EMAIL || "yohaken@gmail.com").toLowerCase();
    if (!isOwner && email) {
      const staff = await db.collection("staff").doc(email).get();
      isOwner = staff.exists && staff.get("role") === "owner";
    }
    if (!isOwner) {
      throw new functions.https.HttpsError("permission-denied", "เฉพาะเจ้าของ");
    }

    const force = data?.force !== false;
    const result = await evaluateAndSendLowBalanceLine({ force });
    const reasonTh = {
      sent: "ส่ง LINE ยอดต่ำแล้ว",
      above_threshold: `ยอดยังไม่ต่ำกว่าเกณฑ์ (คงเหลือ ${formatBaht(result.balance ?? 0)} / เกณฑ์ ${formatBaht(result.threshold)})`,
      outside_hours: `อยู่นอกช่วงเวลาส่ง (${result.window}) · ชั่วโมงนี้ ${String(result.hour).padStart(2, "0")}:xx`,
      missing_line_credentials: "ยังไม่มี Channel access token / User ID",
      threshold_disabled: "ปิดเกณฑ์ยอดต่ำอยู่",
      instant_line_disabled: "ปิดแจ้งทันทีไป LINE อยู่",
      cooldown: "ส่งไปแล้วเร็วๆ นี้ (คูลดาวน์ 3 ชม. ขณะยอดยังต่ำ)",
      retry_wait: "รอสักครู่แล้วลองใหม่หลังส่งไม่สำเร็จครั้งก่อน",
      line_error: `LINE ตอบผิดพลาด: ${result.line?.error || ""}`,
      no_balance: "อ่านยอดคงเหลือไม่ได้",
    };
    return {
      ok: Boolean(result.sent),
      detail: reasonTh[result.reason] || result.reason || "ตรวจแล้ว",
      result,
    };
  });

exports.syncTaskOccurrencesDaily = functions
  .region("asia-southeast1")
  .pubsub.schedule("0 6 * * *")
  .timeZone("Asia/Bangkok")
  .onRun(async () => {
    const db = getFirestore();
    const result = await runSyncWithAdmin(db);
    console.log("task occurrence sync", result);
    return null;
  });

/** POS tablet sign-in — no Firebase Console Anonymous toggle required. */
/** Staff Google bridge ticket → idToken (Admin SDK; legacy bridge fallback). */
exports.exchangeLoginTicket = require("./auth-login-ticket").exchangeLoginTicket;

exports.posDeviceAuth = functions
  .region("asia-southeast1")
  .https.onCall(async (data) => {
    const crypto = require("crypto");
    const { getAuth } = require("firebase-admin/auth");

    let deviceId = typeof data?.deviceId === "string" ? data.deviceId.trim() : "";
    if (!deviceId || deviceId.length < 8 || deviceId.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(deviceId)) {
      deviceId = crypto.randomUUID();
    }

    const token = await getAuth().createCustomToken(deviceId, { posDevice: true });
    return { token, deviceId };
  });

/** POS sale — Admin SDK (ไม่พึ่ง Firestore rules ฝั่ง client). */
exports.posCompleteSale = functions
  .region("asia-southeast1")
  .https.onCall(async (data, context) => {
    if (!isPosCaller(context.auth)) {
      throw new functions.https.HttpsError("permission-denied", "ไม่ใช่เครื่อง POS");
    }
    const db = getFirestore();
    try {
      return await completePosSaleAdmin(db, data, context.auth.uid);
    } catch (err) {
      if (err instanceof functions.https.HttpsError) throw err;
      const detail = err?.message || String(err);
      console.error("posCompleteSale failed", detail, err);
      throw new functions.https.HttpsError("internal", `บันทึกการขายไม่สำเร็จ — ${detail.slice(0, 120)}`);
    }
  });

/**
 * Owner BOH: after voiding a sale, restore redeem + reverse earn (best-effort).
 * Idempotent — safe to call twice.
 */
exports.posOwnerReverseSalePoints = functions
  .region("asia-southeast1")
  .https.onCall(async (data, context) => {
    const { assertOwner } = require("./npos-owner-device");
    const { tryReverseMemberPointsForVoid } = require("./pos-members");
    const { actorId } = await assertOwner(context);
    const saleId = typeof data?.saleId === "string" ? data.saleId.trim() : "";
    if (!saleId) {
      throw new functions.https.HttpsError("invalid-argument", "ระบุ saleId");
    }
    const result = await tryReverseMemberPointsForVoid(getFirestore(), {
      saleId,
      actorId: actorId || "owner",
    });
    return { ok: true, saleId, ...result };
  });
