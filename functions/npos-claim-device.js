/**
 * Tablet HTTP: claim this install with the shop store code (half-login).
 */
const functions = require("firebase-functions/v1");
const { getFirestore } = require("firebase-admin/firestore");
const {
  DEVICES,
  hashStoreCode,
  isValidStoreCodeShape,
  loadStoreClaimPolicy,
  normalizeStoreCode,
} = require("./npos-device-gate");

function cors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
}

function asString(v, max = 200) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

function parseBody(req) {
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  return body && typeof body === "object" ? body : null;
}

exports.nposClaimDevice = functions.region("asia-southeast1").https.onRequest(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "POST only" });
    return;
  }

  const body = parseBody(req);
  const installId = asString(body?.installId, 64);
  const storeCode = normalizeStoreCode(body?.storeCode);
  if (!installId || installId.length < 8 || !/^[a-zA-Z0-9_-]+$/.test(installId)) {
    res.status(400).json({ ok: false, error: "invalid_installId", code: "invalid_installId" });
    return;
  }
  if (!isValidStoreCodeShape(storeCode)) {
    res.status(400).json({ ok: false, error: "รหัสร้านไม่ถูกต้อง", code: "invalid_code" });
    return;
  }

  try {
    const db = getFirestore();
    const policy = await loadStoreClaimPolicy(db);
    if (!policy.required || !policy.hash) {
      res.status(400).json({
        ok: false,
        error: "ยังไม่ได้ตั้งรหัสร้านจากหลังบ้าน",
        code: "claim_not_configured",
      });
      return;
    }

    const submitted = hashStoreCode(storeCode);
    if (!submitted || submitted !== policy.hash) {
      res.status(403).json({ ok: false, error: "รหัสร้านไม่ตรง", code: "bad_code" });
      return;
    }

    const ref = db.collection(DEVICES).doc(installId);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({
        ok: false,
        error: "ยังไม่พบเครื่อง — รอ heartbeat แล้วลองใหม่",
        code: "device_unknown",
      });
      return;
    }

    const data = snap.data() || {};
    if (data.blocked === true || data.deviceClass === "blocked") {
      res.status(403).json({ ok: false, error: "เครื่องนี้ถูกบล็อก", code: "device_blocked" });
      return;
    }

    if (policy.rejectDev) {
      const isDev =
        data.isEmulator === true ||
        data.deviceClass === "dev" ||
        /sdk|emulator|generic|goldfish|ranchu/i.test(asString(data.deviceHint, 120));
      if (isDev) {
        res.status(403).json({
          ok: false,
          error: "เครื่องจำลองถูกปิดกั้นช่วงทดลองหน้าร้าน",
          code: "device_dev_rejected",
        });
        return;
      }
    }

    const now = Date.now();
    await ref.set(
      {
        storeClaimed: true,
        storeClaimedAt: now,
        storeClaimMethod: "code",
        updatedAt: now,
      },
      { merge: true },
    );

    res.status(200).json({
      ok: true,
      installId,
      storeClaimed: true,
      storeClaimedAt: now,
      storeClaimRequired: true,
    });
  } catch (err) {
    console.error("nposClaimDevice", err);
    res.status(500).json({ ok: false, error: "claim_failed" });
  }
});
