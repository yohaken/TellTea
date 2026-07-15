const crypto = require("crypto");
const { getStorage } = require("firebase-admin/storage");
const functions = require("firebase-functions/v1");

const DEFAULT_BUCKET = "mypeer-501909.firebasestorage.app";

function evidenceBucket() {
  const preferred = process.env.TELLTEA_STORAGE_BUCKET || DEFAULT_BUCKET;
  const storage = getStorage();
  return storage.bucket(preferred);
}

function safeSegment(raw, max = 48) {
  return (
    String(raw || "x")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .slice(0, max) || "x"
  );
}

function assertSignedIn(context) {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "ยังไม่ได้เข้าสู่ระบบ — เข้าสู่ระบบก่อนแนบรูป");
  }
  const token = context.auth.token || {};
  if (!token.email && !token.phone_number) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "บัญชีนี้ไม่มีอีเมลหรือเบอร์โทร — ไม่สามารถอัปโหลดหลักฐานได้",
    );
  }
}

const ALLOWED_FOLDERS = new Set(["owner-books", "ot-photos", "ledger-receipts"]);

/**
 * Step 1: signed PUT URL (Admin) — client uploads real bytes with XHR progress.
 * Does not require client Firebase Storage rules.
 */
exports.createEvidenceUpload = functions
  .region("asia-southeast1")
  .runWith({ memory: "256MB", timeoutSeconds: 60 })
  .https.onCall(async (data, context) => {
    assertSignedIn(context);

    const folder = safeSegment(data?.folder || "");
    if (!ALLOWED_FOLDERS.has(folder)) {
      throw new functions.https.HttpsError("invalid-argument", "โฟลเดอร์อัปโหลดไม่ถูกต้อง");
    }
    const slotKey = safeSegment(data?.slotKey || "entry");
    const contentType = String(data?.contentType || "image/jpeg").slice(0, 80);
    if (!contentType.startsWith("image/")) {
      throw new functions.https.HttpsError("invalid-argument", "ไฟล์ต้องเป็นรูปภาพ");
    }
    const originalName = safeSegment(data?.fileName || "slip", 40);
    const ext =
      contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
    const token = crypto.randomUUID();
    const objectPath = `${folder}/${slotKey}/${Date.now()}_${crypto
      .randomBytes(4)
      .toString("hex")}_${originalName}.${ext}`;

    const bucket = evidenceBucket();
    const bucketName = bucket.name || DEFAULT_BUCKET;
    const file = bucket.file(objectPath);

    const [uploadUrl] = await file.getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + 20 * 60 * 1000,
      contentType,
    });

    return {
      uploadUrl,
      path: objectPath,
      token,
      contentType,
      bucket: bucketName,
      expiresInSec: 20 * 60,
    };
  });

/**
 * Step 2: after PUT — attach Firebase download token and return stable media URL.
 */
exports.finalizeEvidenceUpload = functions
  .region("asia-southeast1")
  .runWith({ memory: "256MB", timeoutSeconds: 60 })
  .https.onCall(async (data, context) => {
    assertSignedIn(context);
    const objectPath = String(data?.path || "");
    if (!objectPath || objectPath.includes("..") || objectPath.startsWith("/")) {
      throw new functions.https.HttpsError("invalid-argument", "path ไม่ถูกต้อง");
    }
    const folder = objectPath.split("/")[0];
    if (!ALLOWED_FOLDERS.has(folder)) {
      throw new functions.https.HttpsError("permission-denied", "โฟลเดอร์ไม่ถูกต้อง");
    }

    const token = String(data?.token || crypto.randomUUID());
    const bucket = evidenceBucket();
    const file = bucket.file(objectPath);
    const [exists] = await file.exists();
    if (!exists) {
      throw new functions.https.HttpsError("not-found", "ยังไม่พบไฟล์บนคลังรูป — อัปโหลดใหม่อีกครั้ง");
    }

    const [meta] = await file.getMetadata();
    await file.setMetadata({
      contentType: meta.contentType || "image/jpeg",
      metadata: {
        ...(meta.metadata || {}),
        firebaseStorageDownloadTokens: token,
        uploadedBy: context.auth.uid,
        evidence: "1",
      },
    });

    const bucketName = bucket.name || DEFAULT_BUCKET;
    const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(
      objectPath,
    )}?alt=media&token=${token}`;

    return { downloadUrl, path: objectPath, token, size: Number(meta.size) || 0 };
  });

/**
 * Direct Admin upload (no signed URL / no client Storage rules).
 * Used when getSignedUrl/IAM is unavailable. One photo per call (≤10MB).
 */
exports.uploadEvidencePhoto = functions
  .region("asia-southeast1")
  .runWith({ memory: "1024MB", timeoutSeconds: 120 })
  .https.onCall(async (data, context) => {
    assertSignedIn(context);

    const folder = safeSegment(data?.folder || "");
    if (!ALLOWED_FOLDERS.has(folder)) {
      throw new functions.https.HttpsError("invalid-argument", "โฟลเดอร์อัปโหลดไม่ถูกต้อง");
    }
    const slotKey = safeSegment(data?.slotKey || "entry");
    const contentType = String(data?.contentType || "image/jpeg").slice(0, 80);
    if (!contentType.startsWith("image/")) {
      throw new functions.https.HttpsError("invalid-argument", "ไฟล์ต้องเป็นรูปภาพ");
    }
    const base64 = String(data?.base64 || "");
    if (!base64 || base64.length < 32) {
      throw new functions.https.HttpsError("invalid-argument", "ไม่มีข้อมูลรูป");
    }
    let buffer;
    try {
      buffer = Buffer.from(base64, "base64");
    } catch {
      throw new functions.https.HttpsError("invalid-argument", "ข้อมูลรูปไม่ถูกต้อง");
    }
    if (!buffer.length) {
      throw new functions.https.HttpsError("invalid-argument", "ไฟล์ว่าง");
    }
    if (buffer.length > 10 * 1024 * 1024) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "รูปใหญ่เกิน 10MB — เลือกไฟล์หลักฐานที่เล็กกว่านี้เล็กน้อย",
      );
    }

    const originalName = safeSegment(data?.fileName || "slip", 40);
    const ext =
      contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
    const token = crypto.randomUUID();
    const objectPath = `${folder}/${slotKey}/${Date.now()}_${crypto
      .randomBytes(4)
      .toString("hex")}_${originalName}.${ext}`;

    const bucket = evidenceBucket();
    const bucketName = bucket.name || DEFAULT_BUCKET;
    const file = bucket.file(objectPath);
    await file.save(buffer, {
      resumable: false,
      metadata: {
        contentType,
        metadata: {
          firebaseStorageDownloadTokens: token,
          uploadedBy: context.auth.uid,
          folder,
          slotKey,
          evidence: "1",
          originalName: String(data?.fileName || "").slice(0, 120),
        },
      },
    });

    const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(
      objectPath,
    )}?alt=media&token=${token}`;

    return { downloadUrl, path: objectPath, token, size: buffer.length };
  });
