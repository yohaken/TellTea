/**
 * Stream nPos capture JPEGs via Admin SDK.
 * Firebase token URLs on the OT/GCS bucket return HTTP 412 for browsers;
 * signed URLs often fail in CF without signBlob. This proxy is the reliable
 * user-visible <img src> for back-office.
 */
const functions = require("firebase-functions/v1");
const { getFirestore } = require("firebase-admin/firestore");
const { resolveStorageBucket } = require("./storage-bucket");

const REGION = "asia-southeast1";
const MEDIA_BASE = `https://${REGION}-mypeer-501909.cloudfunctions.net/nposCaptureMedia`;

function cors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
}

function asString(v, max = 200) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

/** Public HTTPS URL for BO thumbs / lightbox (works even when Storage tokens 412). */
function captureMediaUrl(shotId, role) {
  const id = asString(shotId, 160);
  const r = role === "secondary" ? "secondary" : "primary";
  if (!id) return "";
  return `${MEDIA_BASE}?id=${encodeURIComponent(id)}&role=${r}`;
}

exports.captureMediaUrl = captureMediaUrl;

exports.nposCaptureMedia = functions
  .region(REGION)
  .runWith({ memory: "512MB", timeoutSeconds: 60 })
  .https.onRequest(async (req, res) => {
    cors(res);
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "GET") {
      res.status(405).json({ ok: false, error: "GET only" });
      return;
    }

    const shotId = asString(req.query.id, 160);
    const role = asString(req.query.role, 16) === "secondary" ? "secondary" : "primary";
    if (!shotId || shotId.length < 8) {
      res.status(400).json({ ok: false, error: "invalid id" });
      return;
    }

    try {
      const snap = await getFirestore().collection("nposScreenShots").doc(shotId).get();
      if (!snap.exists) {
        res.status(404).json({ ok: false, error: "not_found" });
        return;
      }
      const data = snap.data() || {};
      const side = data[role] && typeof data[role] === "object" ? data[role] : {};
      const objectPath = asString(side.path, 400);
      if (!objectPath || !objectPath.startsWith("npos-screenshots/")) {
        res.status(404).json({ ok: false, error: "no_path" });
        return;
      }

      const bucket = await resolveStorageBucket();
      const file = bucket.file(objectPath);
      const [exists] = await file.exists();
      if (!exists) {
        res.status(404).json({ ok: false, error: "missing_object" });
        return;
      }

      res.set("Content-Type", "image/jpeg");
      res.set("Cache-Control", "public,max-age=86400");
      res.set("X-Content-Type-Options", "nosniff");
      const stream = file.createReadStream();
      stream.on("error", (err) => {
        console.error("nposCaptureMedia stream error", shotId, err?.message || err);
        if (!res.headersSent) {
          res.status(500).json({ ok: false, error: "stream_failed" });
        } else {
          res.end();
        }
      });
      stream.pipe(res);
    } catch (err) {
      console.error("nposCaptureMedia failed", err);
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: err?.message || "read failed" });
      }
    }
  });
