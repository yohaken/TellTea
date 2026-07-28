/**
 * nPos device heartbeat — Admin upsert into posDevices/{installId}
 * so back-office can see native tablets online without Firebase Auth SDK on device.
 *
 * Dedupes by stableKey (ANDROID_ID): when the same physical device reinstalls /
 * gets a new installId, older sibling docs are marked disabled so the admin list
 * does not look like many machines from one emulator.
 *
 * deviceClass: shop | dev | blocked
 * - client sends shop/dev (emulator → dev)
 * - BO can set blocked; heartbeat must not clear that
 */
const functions = require("firebase-functions/v1");
const { getFirestore } = require("firebase-admin/firestore");
const { claimStatusForHeartbeat } = require("./npos-device-gate");

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

function normalizeDeviceClass(v) {
  const s = asString(v, 16).toLowerCase();
  if (s === "shop" || s === "dev" || s === "blocked") return s;
  return "";
}

function clientDeviceClass(body) {
  const explicit = normalizeDeviceClass(body.deviceClass);
  if (explicit === "shop" || explicit === "dev") return explicit;
  if (body.isEmulator === true) return "dev";
  return "shop";
}

/** Recover ANDROID_ID from installId `npos` + hex (≤20) when client omitted stableKey. */
function inferStableKey(rawKey, installId) {
  const sk = asString(rawKey, 120).toLowerCase();
  if (sk.length >= 8) return sk;
  const compact = String(installId || "")
    .replace(/-/g, "")
    .toLowerCase();
  const m = /^npos([a-f0-9]+)$/.exec(compact);
  if (!m) return "";
  const hex = m[1];
  if (hex.length >= 8 && hex.length <= 20) return hex;
  return "";
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
    const stableKey = inferStableKey(body.stableKey, installId);
    const isEmulator =
      body.isEmulator === true ||
      /sdk|emulator|generic|goldfish|ranchu/i.test(deviceHint);
    const now = Date.now();
    const pairingCode = pairingCodeFromId(installId);

    try {
      const db = getFirestore();
      const ref = db.collection(COL).doc(installId);
      const snap = await ref.get();
      const prev = snap.exists ? snap.data() || {} : {};
      const wasBlocked =
        prev.deviceClass === "blocked" || prev.blocked === true;
      const deviceClass = wasBlocked ? "blocked" : clientDeviceClass(body);

      const patch = {
        authUid: installId,
        pairingCode,
        lastSeenAt: now,
        appBuild: versionCode,
        versionName,
        userAgent: `nPos-telltea/${versionName}`,
        shellKind: "native",
        nativeShellBuild: versionCode,
        platform: "android",
        standalone: true,
        deviceHint: deviceHint || "nPos-telltea",
        screenSize,
        telemetryAt: now,
        updatedAt: now,
        isEmulator,
        deviceClass,
        // Heartbeat must not un-block a manually blocked install.
        disabled: wasBlocked ? true : false,
        blocked: wasBlocked ? true : false,
      };
      if (stableKey) {
        patch.stableKey = stableKey;
      }
      if (Object.prototype.hasOwnProperty.call(body, "printerReady")) {
        patch.printerReady = body.printerReady === true || body.printerReady === "true";
        // Drawer kicks through the selected receipt printer endpoint.
        if (!Object.prototype.hasOwnProperty.call(body, "drawerReady")) {
          patch.drawerReady = patch.printerReady;
        }
      }
      if (Object.prototype.hasOwnProperty.call(body, "drawerReady")) {
        patch.drawerReady = body.drawerReady === true || body.drawerReady === "true";
      }
      if (Object.prototype.hasOwnProperty.call(body, "printerLabel")) {
        patch.printerLabel = asString(body.printerLabel, 80);
      }
      if (Object.prototype.hasOwnProperty.call(body, "customerDisplay")) {
        patch.customerDisplay = asString(body.customerDisplay, 24) || "unknown";
      }
      if (Object.prototype.hasOwnProperty.call(body, "permissionsOk")) {
        patch.permissionsOk = body.permissionsOk === true || body.permissionsOk === "true";
      }
      if (Object.prototype.hasOwnProperty.call(body, "permissionsStatus")) {
        patch.permissionsStatus = asString(body.permissionsStatus, 120);
      }
      if (Number.isFinite(Number(body.syncPendingCount))) {
        patch.syncPendingCount = Math.max(0, Math.floor(Number(body.syncPendingCount)));
      }
      if (Number.isFinite(Number(body.syncFailedCount))) {
        patch.syncFailedCount = Math.max(0, Math.floor(Number(body.syncFailedCount)));
      }

      if (!snap.exists) {
        // Defaults only — never overwrite equipment fields already set from this body.
        const created = {
          label: "",
          registeredAt: now,
          forceReloadAt: 0,
          lastReloadAckAt: 0,
          syncPendingCount: 0,
          syncFailedCount: 0,
          syncStuckAt: 0,
          syncLastError: "",
          printerLabel: "",
          printerReady: false,
          drawerReady: false,
          versionName: versionName || "0",
          updateStatus: "idle",
          updateTargetBuild: 0,
          updateError: "",
          updateCheckedAt: 0,
          ownerPingAt: 0,
          ownerPingMessage: "",
          lastOwnerPingAckAt: 0,
          captureRequestAt: 0,
          lastCaptureAckAt: 0,
          lastCaptureAt: 0,
          captureIntervalMinutes: 0,
          customerDisplay: "unknown",
          storeClaimed: false,
        };
        for (const [k, v] of Object.entries(created)) {
          if (!Object.prototype.hasOwnProperty.call(patch, k)) patch[k] = v;
        }
      }
      // Heartbeat must never grant or clear storeClaimed / owner claim fields.
      await ref.set(patch, { merge: true });

      // Re-read after merge for capture command fields (owner may have set them).
      const afterSnap = await ref.get();
      const after = afterSnap.exists ? afterSnap.data() || {} : {};
      const claim = await claimStatusForHeartbeat(db, installId, after);

      let heartbeatIntervalSec = 5;
      try {
        const metaPos = await db.collection("meta").doc("pos").get();
        const raw = metaPos.exists ? metaPos.get("heartbeatIntervalSec") : null;
        const n = typeof raw === "number" ? raw : Number(raw);
        if (Number.isFinite(n)) {
          heartbeatIntervalSec = Math.max(5, Math.min(600, Math.round(n)));
        }
      } catch (err) {
        console.warn("nposDeviceHeartbeat heartbeatIntervalSec read failed", err);
      }
      const captureRequestAt =
        typeof after.captureRequestAt === "number" ? after.captureRequestAt : 0;
      const lastCaptureAckAt =
        typeof after.lastCaptureAckAt === "number" ? after.lastCaptureAckAt : 0;
      const lastCaptureAt = typeof after.lastCaptureAt === "number" ? after.lastCaptureAt : 0;
      const captureIntervalMinutes = Number.isFinite(after.captureIntervalMinutes)
        ? Math.max(0, Math.floor(after.captureIntervalMinutes))
        : 0;
      const pendingManual = captureRequestAt > 0 && captureRequestAt > lastCaptureAckAt;
      const intervalDue =
        captureIntervalMinutes > 0 &&
        (lastCaptureAt <= 0 || now - lastCaptureAt >= captureIntervalMinutes * 60 * 1000);

      // Mark older docs with same stableKey as disabled (reinstall / wipe ghosts).
      // Do not overwrite deviceClass=blocked on siblings.
      let staleMarked = 0;
      if (stableKey) {
        const siblings = await db.collection(COL).where("stableKey", "==", stableKey).limit(25).get();
        const batch = db.batch();
        let batchOps = 0;
        siblings.forEach((doc) => {
          if (doc.id === installId) return;
          const siblingClass = doc.get("deviceClass");
          const siblingBlocked = siblingClass === "blocked" || doc.get("blocked") === true;
          batch.set(
            doc.ref,
            {
              disabled: true,
              lastSeenAt: typeof doc.get("lastSeenAt") === "number" ? doc.get("lastSeenAt") : 0,
              updatedAt: now,
              supersededBy: installId,
              ...(siblingBlocked
                ? { deviceClass: "blocked", blocked: true }
                : {}),
            },
            { merge: true },
          );
          batch.set(
            db.collection("nposDiagnose").doc(doc.id),
            {
              disabled: true,
              supersededBy: installId,
              stableKey,
              updatedAt: now,
            },
            { merge: true },
          );
          staleMarked += 1;
          batchOps += 2;
        });
        if (batchOps > 0) await batch.commit();
      }

      // Repair open-session date keys (legacy UTC midnight → Bangkok day) so BO today shows them.
      try {
        const { startOfBangkokDay } = require("./bangkok-day");
        const openSnap = await db
          .collection("posSessions")
          .where("status", "==", "open")
          .where("deviceId", "==", installId)
          .limit(5)
          .get();
        for (const doc of openSnap.docs) {
          const data = doc.data() || {};
          const openedAt = Number(data.openedAt) || now;
          const correct = startOfBangkokDay(openedAt);
          if (Number(data.date) !== correct) {
            await doc.ref.set({ date: correct, updatedAt: now, dateRepairedAt: now }, { merge: true });
          }
        }
      } catch (repairErr) {
        console.warn("nposDeviceHeartbeat session date repair failed", repairErr);
      }

      // Cooperative session signal (same channel as kick): if tablet still holds a
      // local sessionId that BO already closed, tell native to settle — not revoke seat.
      let sessionRemoteClosed = false;
      let sessionCloseSource = "";
      let sessionClosedAt = 0;
      let sessionStatus = "";
      const clientSessionId = asString(body.sessionId, 80);
      if (clientSessionId) {
        try {
          const sessSnap = await db.collection("posSessions").doc(clientSessionId).get();
          if (sessSnap.exists) {
            const sess = sessSnap.data() || {};
            sessionStatus = asString(sess.status, 16) || "open";
            if (sessionStatus === "closed") {
              sessionRemoteClosed = true;
              sessionCloseSource = asString(sess.closeSource, 40);
              sessionClosedAt = Number(sess.closedAt) || 0;
            }
          }
        } catch (sessErr) {
          console.warn("nposDeviceHeartbeat session status read failed", sessErr);
        }
      }

      res.status(200).json({
        ok: true,
        installId,
        stableKey: stableKey || null,
        isEmulator,
        deviceClass,
        pairingCode,
        lastSeenAt: now,
        versionCode,
        versionName,
        staleMarked,
        storeClaimRequired: claim.storeClaimRequired,
        storeClaimed: claim.storeClaimed,
        storeClaimRejectDev: claim.storeClaimRejectDev,
        deviceBlocked: claim.deviceBlocked,
        seatMode: claim.seatMode || "exclusive",
        activeSeatInstallId: claim.activeSeatInstallId || "",
        seatHeldByMe: claim.seatHeldByMe === true,
        seatTaken: claim.seatTaken === true,
        kicked: claim.kicked === true,
        storeClaimCodeHash: claim.storeClaimCodeHash || "",
        storeClaimUpdatedAt: claim.storeClaimUpdatedAt || 0,
        heartbeatIntervalSec,
        sessionId: clientSessionId || "",
        sessionStatus,
        sessionRemoteClosed,
        sessionCloseSource,
        sessionClosedAt,
        capture: {
          requestAt: captureRequestAt,
          intervalMinutes: captureIntervalMinutes,
          due: pendingManual || intervalDue,
        },
      });
    } catch (err) {
      console.error("nposDeviceHeartbeat failed", err);
      res.status(500).json({ ok: false, error: "write failed" });
    }
  });
