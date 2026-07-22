/**
 * Compact nPos ops timeline — errors / hardware / display / printer events
 * so back-office (and agents) can fix without asking shop staff for tech detail.
 *
 * Collection: nposOpsLog/{installId}
 * Doc keeps a ring buffer of recent events (not a huge file dump).
 */
const functions = require("firebase-functions/v1");
const { getFirestore } = require("firebase-admin/firestore");

const COL = "nposOpsLog";
const MAX_EVENTS = 60;
const MAX_BATCH = 25;

function cors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
}

function asString(v, max = 200) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

function normalizeLevel(v) {
  const s = asString(v, 16).toLowerCase();
  if (s === "error" || s === "warn" || s === "info") return s;
  return "info";
}

function mapEvents(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_BATCH).map((e) => {
    const at = Number.isFinite(e?.at) ? Math.floor(e.at) : Date.now();
    return {
      at,
      level: normalizeLevel(e?.level),
      cat: asString(e?.cat, 32) || "app",
      msg: asString(e?.msg, 160) || "—",
      detail: asString(e?.detail, 280),
      ok: e?.ok === true ? true : e?.ok === false ? false : null,
    };
  });
}

exports.reportNposOpsLog = functions
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

    const incoming = mapEvents(body.events);
    if (incoming.length === 0) {
      res.status(400).json({ ok: false, error: "events_required" });
      return;
    }

    const versionCode = Number.isFinite(body.versionCode) ? Math.floor(body.versionCode) : 0;
    const versionName = asString(body.versionName, 32) || "0";
    const stableKey = asString(body.stableKey, 120);
    const isEmulator = body.isEmulator === true;
    const classRaw = asString(body.deviceClass, 16).toLowerCase();
    const deviceClass =
      classRaw === "shop" || classRaw === "dev" || classRaw === "blocked"
        ? classRaw
        : isEmulator
          ? "dev"
          : "shop";
    const now = Date.now();

    try {
      const db = getFirestore();
      const ref = db.collection(COL).doc(installId);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const prev = snap.exists && Array.isArray(snap.get("events")) ? snap.get("events") : [];
        const prevBlocked =
          snap.exists && (snap.get("deviceClass") === "blocked" || snap.get("blocked") === true);
        const tagged = incoming.map((e) => ({
          ...e,
          vc: versionCode,
          vn: versionName,
        }));
        const events = [...prev, ...tagged].slice(-MAX_EVENTS);
        tx.set(
          ref,
          {
            installId,
            stableKey: stableKey || (snap.exists ? snap.get("stableKey") || "" : ""),
            isEmulator,
            deviceClass: prevBlocked ? "blocked" : deviceClass,
            blocked: prevBlocked ? true : false,
            updatedAt: now,
            versionCode,
            versionName,
            eventCount: events.length,
            lastLevel: tagged[tagged.length - 1].level,
            lastMsg: tagged[tagged.length - 1].msg,
            lastAt: tagged[tagged.length - 1].at,
            events,
            source: "npos-telltea",
          },
          { merge: true },
        );
      });

      res.status(200).json({
        ok: true,
        installId,
        stableKey: stableKey || null,
        deviceClass: deviceClass,
        accepted: incoming.length,
        updatedAt: now,
      });
    } catch (err) {
      console.error("reportNposOpsLog failed", err);
      res.status(500).json({ ok: false, error: "write failed" });
    }
  });
