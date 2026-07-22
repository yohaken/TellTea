/**
 * Receive nPos-telltea diagnose snapshots from tablets (no Firebase Auth SDK required).
 * Admin SDK write → collection nposDiagnose/{installId}
 */
const functions = require("firebase-functions/v1");
const { getFirestore } = require("firebase-admin/firestore");

const COL = "nposDiagnose";
const MAX_DISPLAYS = 8;
const MAX_HARDWARE = 40;

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
  return raw
    .slice(0, MAX_DISPLAYS)
    .map((d, i) => ({
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

function mapHardware(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_HARDWARE).map((h) => ({
    category: asString(h?.category, 40) || "อื่น",
    title: asString(h?.title, 120) || "—",
    detail: asString(h?.detail, 240),
  }));
}

exports.reportNposDiagnose = functions
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
    if (!installId || !/^[a-zA-Z0-9_-]+$/.test(installId) || installId.length < 8) {
      res.status(400).json({ ok: false, error: "invalid installId" });
      return;
    }

    const versionCode = Number.isFinite(body.versionCode) ? Math.floor(body.versionCode) : 0;
    const versionName = asString(body.versionName, 32) || "0";
    const stableKey = inferStableKey(body.stableKey, installId);
    const isEmulator = body.isEmulator === true;
    const classRaw = asString(body.deviceClass, 16).toLowerCase();
    const deviceClass =
      classRaw === "shop" || classRaw === "dev" || classRaw === "blocked"
        ? classRaw
        : isEmulator
          ? "dev"
          : "shop";
    const displays = mapDisplays(body.displays);
    const hardware = mapHardware(body.hardware);
    const summary =
      asString(body.summary, 160) ||
      `จอ ${displays.length} · เชื่อมต่อ ${hardware.length}`;
    const reportedAt = Date.now();

    try {
      const db = getFirestore();
      const ref = db.collection(COL).doc(installId);
      const snap = await ref.get();
      const prevBlocked =
        snap.exists && (snap.get("deviceClass") === "blocked" || snap.get("blocked") === true);

      const customerDisplay =
        asString(body.customerDisplay, 24) ||
        (displays.some((d) => !d.primary) ? "ok" : "missing");

      const doc = {
        installId,
        stableKey: stableKey || (snap.exists ? snap.get("stableKey") || "" : ""),
        isEmulator,
        deviceClass: prevBlocked ? "blocked" : deviceClass,
        blocked: prevBlocked ? true : false,
        reportedAt,
        versionCode,
        versionName,
        summary,
        customerDisplay,
        displays,
        hardware,
        source: "npos-telltea",
        updatedAt: reportedAt,
      };

      await ref.set(doc, { merge: true });
      res.status(200).json({
        ok: true,
        installId,
        stableKey: stableKey || null,
        deviceClass: doc.deviceClass,
        reportedAt,
        summary,
      });
    } catch (err) {
      console.error("reportNposDiagnose failed", err);
      res.status(500).json({ ok: false, error: "write failed" });
    }
  });
