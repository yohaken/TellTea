/**
 * Receive nPos screen captures (primary + secondary JPEG base64).
 * Admin upload → Storage npos-screenshots/ + nposScreenShots/{id}
 * Also patches nposDiagnose latest capture URLs and posDevices ack fields.
 */
const crypto = require("crypto");
const functions = require("firebase-functions/v1");
const { getFirestore } = require("firebase-admin/firestore");
const { resolveStorageBucket } = require("./storage-bucket");

const MAX_B64 = 2_500_000; // ~1.8MB binary after decode

function cors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
}

function asString(v, max = 200) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

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

function mapDisplays(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 8).map((d, i) => ({
    number: Number.isFinite(d?.number) ? Math.floor(d.number) : i + 1,
    displayId: Number.isFinite(d?.displayId) ? Math.floor(d.displayId) : -1,
    primary: !!d?.primary,
    name: asString(d?.name, 80) || `display-${i + 1}`,
    widthPx: Number.isFinite(d?.widthPx) ? Math.floor(d.widthPx) : 0,
    heightPx: Number.isFinite(d?.heightPx) ? Math.floor(d.heightPx) : 0,
    densityDpi: Number.isFinite(d?.densityDpi) ? Math.floor(d.densityDpi) : 0,
    refreshHz: Number.isFinite(d?.refreshHz) ? Number(d.refreshHz) : 0,
    rotation: Number.isFinite(d?.rotation) ? Math.floor(d.rotation) : 0,
    orientation: asString(d?.orientation, 16) || "unknown",
  }));
}

async function saveJpeg(installId, role, jpegBase64) {
  if (!jpegBase64 || typeof jpegBase64 !== "string") return null;
  if (jpegBase64.length > MAX_B64) {
    throw new Error(`${role}_too_large`);
  }
  let buffer;
  try {
    buffer = Buffer.from(jpegBase64, "base64");
  } catch {
    throw new Error(`${role}_bad_base64`);
  }
  if (!buffer.length || buffer.length > 1_800_000) {
    throw new Error(`${role}_bad_size`);
  }
  const token = crypto.randomUUID();
  const objectPath = `npos-screenshots/${installId}/${Date.now()}_${role}_${crypto
    .randomBytes(3)
    .toString("hex")}.jpg`;
  const bucket = await resolveStorageBucket();
  const file = bucket.file(objectPath);
  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType: "image/jpeg",
      metadata: {
        firebaseStorageDownloadTokens: token,
        installId,
        role,
        nposCapture: "1",
      },
    },
  });
  // Token URL works without signBlob IAM and loads in mobile browsers.
  const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(
    objectPath,
  )}?alt=media&token=${token}`;
  return { downloadUrl, path: objectPath, bytes: buffer.length, bucket: bucket.name };
}

exports.reportNposScreenCapture = functions
  .region("asia-southeast1")
  .runWith({ memory: "1GB", timeoutSeconds: 120 })
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

    const stableKey = inferStableKey(body.stableKey, installId);
    const isEmulator = body.isEmulator === true;
    const deviceClass =
      asString(body.deviceClass, 16).toLowerCase() === "dev"
        ? "dev"
        : asString(body.deviceClass, 16).toLowerCase() === "blocked"
          ? "blocked"
          : isEmulator
            ? "dev"
            : "shop";
    const reason = asString(body.reason, 32) || "manual";
    const requestAt = Number.isFinite(body.requestAt) ? Math.floor(body.requestAt) : Date.now();
    const capturedAt = Number.isFinite(body.capturedAt) ? Math.floor(body.capturedAt) : Date.now();
    const customerDisplay = asString(body.customerDisplay, 24) || "unknown";
    const displays = mapDisplays(body.displays);

    try {
      const primaryMeta = body.primary && typeof body.primary === "object" ? body.primary : {};
      const secondaryMeta =
        body.secondary && typeof body.secondary === "object" ? body.secondary : {};

      let primaryShot = null;
      let secondaryShot = null;
      if (primaryMeta.ok === true && primaryMeta.jpegBase64) {
        primaryShot = await saveJpeg(installId, "primary", primaryMeta.jpegBase64);
      }
      if (secondaryMeta.ok === true && secondaryMeta.jpegBase64) {
        secondaryShot = await saveJpeg(installId, "secondary", secondaryMeta.jpegBase64);
      }

      if (!primaryShot && !secondaryShot) {
        // Still record failure metadata so BO can see why (ops already logs on device).
        const detail = [
          primaryMeta.ok === true ? "primary_upload_empty" : asString(primaryMeta.detail, 40) || "primary_fail",
          secondaryMeta.ok === true
            ? "secondary_upload_empty"
            : asString(secondaryMeta.detail, 40) || "secondary_fail",
        ].join(" · ");
        console.warn("reportNposScreenCapture no images", installId, detail);
      }

      const db = getFirestore();
      const shotId = `${installId}_${capturedAt}`;
      const doc = {
        id: shotId,
        installId,
        stableKey,
        isEmulator,
        deviceClass,
        reason,
        requestAt,
        capturedAt,
        customerDisplay,
        displays,
        primary: {
          ok: primaryMeta.ok === true && !!primaryShot,
          detail: asString(primaryMeta.detail, 80),
          width: Number.isFinite(primaryMeta.width) ? Math.floor(primaryMeta.width) : 0,
          height: Number.isFinite(primaryMeta.height) ? Math.floor(primaryMeta.height) : 0,
          url: primaryShot?.downloadUrl || "",
          path: primaryShot?.path || "",
          bytes: primaryShot?.bytes || 0,
        },
        secondary: {
          ok: secondaryMeta.ok === true && !!secondaryShot,
          detail: asString(secondaryMeta.detail, 80),
          width: Number.isFinite(secondaryMeta.width) ? Math.floor(secondaryMeta.width) : 0,
          height: Number.isFinite(secondaryMeta.height) ? Math.floor(secondaryMeta.height) : 0,
          url: secondaryShot?.downloadUrl || "",
          path: secondaryShot?.path || "",
          bytes: secondaryShot?.bytes || 0,
        },
        source: "npos-telltea",
        updatedAt: Date.now(),
      };

      await db.collection("nposScreenShots").doc(shotId).set(doc, { merge: true });

      await db
        .collection("nposDiagnose")
        .doc(installId)
        .set(
          {
            installId,
            stableKey,
            customerDisplay,
            displays: displays.length ? displays : undefined,
            latestCaptureAt: capturedAt,
            latestCaptureId: shotId,
            latestPrimaryUrl: doc.primary.url || "",
            latestSecondaryUrl: doc.secondary.url || "",
            latestCaptureReason: reason,
            updatedAt: Date.now(),
          },
          { merge: true },
        );

      await db
        .collection("posDevices")
        .doc(installId)
        .set(
          {
            lastCaptureAckAt: requestAt,
            lastCaptureAt: capturedAt,
            customerDisplay,
            latestPrimaryUrl: doc.primary.url || "",
            latestSecondaryUrl: doc.secondary.url || "",
            updatedAt: Date.now(),
          },
          { merge: true },
        );

      res.status(200).json({
        ok: true,
        installId,
        shotId,
        primaryUrl: doc.primary.url || null,
        secondaryUrl: doc.secondary.url || null,
        capturedAt,
        hasImages: !!(doc.primary.url || doc.secondary.url),
      });
    } catch (err) {
      console.error("reportNposScreenCapture failed", err);
      res.status(500).json({ ok: false, error: err?.message || "write failed" });
    }
  });
