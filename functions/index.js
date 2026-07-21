const functions = require("firebase-functions/v1");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const webpush = require("web-push");
const { runSyncWithAdmin } = require("./task-weekly-sync");
const { completePosSaleAdmin, isPosCaller } = require("./pos-complete-sale");
const evidenceUpload = require("./evidence-upload");
const classifyLedger = require("./classify-ledger");

initializeApp();

exports.createEvidenceUpload = evidenceUpload.createEvidenceUpload;
exports.finalizeEvidenceUpload = evidenceUpload.finalizeEvidenceUpload;
exports.uploadEvidencePhoto = evidenceUpload.uploadEvidencePhoto;
exports.classifyLedgerType = classifyLedger.classifyLedgerType;
exports.reportNposDiagnose = require("./npos-diagnose").reportNposDiagnose;

const VAPID_PUBLIC =
  process.env.VAPID_PUBLIC_KEY ||
  "BI74S6JyDs61V0eqRuS9iy6XdhER9wtA-EXhLfWiEFZSeg2VBBQM1dnPnFsyVY2AQzcKF7gHZm-Eifpsc7cF0Zg";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || "";

const COOLDOWN_MS = 3 * 60 * 60 * 1000; // 3 hours between phone pushes while still low

function formatBaht(n) {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    maximumFractionDigits: 0,
  }).format(n);
}

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

    const db = getFirestore();
    const settingsSnap = await db.doc("meta/settings").get();
    const settings = settingsSnap.exists
      ? settingsSnap.data()
      : { lowBalanceEnabled: true, lowBalanceThreshold: 5000 };

    const enabled = settings.lowBalanceEnabled !== false;
    const threshold = Number(settings.lowBalanceThreshold);
    const thresholdSafe = Number.isFinite(threshold) ? threshold : 5000;

    const alertRef = db.doc("meta/lowBalanceAlert");
    const alertSnap = await alertRef.get();
    const alert = alertSnap.exists ? alertSnap.data() : {};

    if (!enabled || balance >= thresholdSafe) {
      if (alert.active) {
        await alertRef.set(
          { active: false, clearedAt: Date.now(), balance, threshold: thresholdSafe },
          { merge: true },
        );
      }
      return null;
    }

    const lastPushAt = Number(alert.lastPushAt) || 0;
    const stillCooling = Date.now() - lastPushAt < COOLDOWN_MS;
    if (alert.active && stillCooling) {
      await alertRef.set({ active: true, balance, threshold: thresholdSafe }, { merge: true });
      return null;
    }

    const result = await sendToOwnerSubscriptions({
      title: "TellTea — เงินคงเหลือต่ำ",
      body: `คงเหลือ ${formatBaht(balance)} (ต่ำกว่า ${formatBaht(thresholdSafe)}) — แตะเพื่อโอนเข้า`,
      url: "https://telltea-shop.web.app/ledger/?transferIn=1",
    });

    await alertRef.set(
      {
        active: true,
        balance,
        threshold: thresholdSafe,
        lastPushAt: Date.now(),
        lastPushResult: result,
      },
      { merge: true },
    );

    console.log("low balance push", { balance, threshold: thresholdSafe, ...result });
    return null;
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
