/**
 * nPos device heartbeat — Admin upsert into posDevices/{installId}
 * so back-office can see native tablets online without Firebase Auth SDK on device.
 */
const functions = require("firebase-functions/v1");
const { getFirestore } = require("firebase-admin/firestore");

const COL = "posDevices";

function cors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
}

function asString(v, max = 200) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

function pairingCodeFromId(id) {
  return String(id).replace(/-/g, "").slice(-6).toUpperCase();
}

exports.nposDeviceHeartbeat = functions
  .region("asia-southeast1")
  .https.onRequest(async (req, res) => {
    cors(res);
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "POST only" });
      return;
    }

    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        res.status(400).json({ ok: false, error: "invalid JSON" });
        return;
      }
    }
    if (!body || typeof body !== "object") {
      res.status(400).json({ ok: false, error: "missing body" });
      return;
    }

    const installId = asString(body.installId, 64);
    if (!installId || installId.length < 8 || !/^[a-zA-Z0-9_-]+$/.test(installId)) {
      res.status(400).json({ ok: false, error: "invalid installId" });
      return;
    }

    const versionCode = Number.isFinite(body.versionCode) ? Math.floor(body.versionCode) : 0;
    const versionName = asString(body.versionName, 32) || "0";
    const deviceHint = asString(body.deviceHint, 80);
    const screenSize = asString(body.screenSize, 40);
    const now = Date.now();
    const pairingCode = pairingCodeFromId(installId);

    const patch = {
      authUid: installId,
      pairingCode,
      lastSeenAt: now,
      appBuild: versionCode,
      userAgent: `nPos-telltea/${versionName}`,
      shellKind: "native",
      nativeShellBuild: versionCode,
      platform: "android",
      standalone: true,
      deviceHint: deviceHint || "nPos-telltea",
      screenSize,
      telemetryAt: now,
      updatedAt: now,
    };

    try {
      const db = getFirestore();
      const ref = db.collection(COL).doc(installId);
      const snap = await ref.get();
      if (!snap.exists) {
        Object.assign(patch, {
          label: "",
          registeredAt: now,
          disabled: false,
          forceReloadAt: 0,
          lastReloadAckAt: 0,
          syncPendingCount: 0,
          syncFailedCount: 0,
          syncStuckAt: 0,
          syncLastError: "",
          printerLabel: "",
          printerReady: false,
          updateStatus: "idle",
          updateTargetBuild: 0,
          updateError: "",
          updateCheckedAt: 0,
          ownerPingAt: 0,
          ownerPingMessage: "",
          lastOwnerPingAckAt: 0,
        });
      }
      await ref.set(patch, { merge: true });
      res.status(200).json({
        ok: true,
        installId,
        pairingCode,
        lastSeenAt: now,
        versionCode,
        versionName,
      });
    } catch (err) {
      console.error("nposDeviceHeartbeat failed", err);
      res.status(500).json({ ok: false, error: "write failed" });
    }
  });
