/**
 * VAT mail → Google Drive spine (F0/F1)
 * โฟลเดอร์ชั่วคราว: TellTea-VAT/{grab|lineman|shopee}/  (กองรวม · ยังไม่แยกเดือน)
 * periodMonthKey เก็บในดัชนีเมลไว้จัดทีหลังเมื่อนิ่ง
 * Meta: meta/vatMailDrive · ดัชนีบน platformEmailReports.driveFiles[]
 * Scope: drive.file (เฉพาะไฟล์ที่แอพสร้าง)
 */
const functions = require("firebase-functions/v1");
const { getFirestore } = require("firebase-admin/firestore");
const {
  listDriveableParts,
  fetchAttachmentBuffer,
  decodeAttachmentData,
  MAX_PDF_BYTES,
} = require("./vat-mail-pdf");

const REGION = "asia-southeast1";
const OWNER_EMAIL = String(process.env.TELLTEA_OWNER_EMAIL || "yohaken@gmail.com")
  .trim()
  .toLowerCase();

const OAUTH_DOC = "meta/vatMailOAuth";
const OAUTH_CONFIG_DOC = "meta/vatMailOAuthConfig";
const DRIVE_META_DOC = "meta/vatMailDrive";
const REPORTS_COL = "platformEmailReports";

const ROOT_FOLDER_NAME = "TellTea-VAT";
const CHANNELS = ["grab", "lineman", "shopee"];
/** ย้อนหลายหน้าแคตตาล็อก · รวมคาบเกี่ยวต้น/ปลายเดือน */
const MAX_REPORTS_PER_SYNC = 160;
const MAX_CATALOG_READ = 500;
const MAX_FILES_PER_MESSAGE = 6;
const MAX_ATTACH_BYTES = MAX_PDF_BYTES;
/** วันคาบเกี่ยวรอบขอบเดือน (รับเมลช้า / รายงานข้ามเดือน) */
const MONTH_OVERLAP_DAYS = 5;

function asString(v, max = 200) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

async function assertOwner(context) {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "ต้องเข้าสู่ระบบก่อน");
  }
  const email = asString(context.auth.token?.email, 120).toLowerCase();
  if (email && email === OWNER_EMAIL) return { actorId: email };
  const db = getFirestore();
  let staffId = email;
  if (!staffId) {
    const phone = asString(context.auth.token?.phone_number, 32);
    const digits = phone.startsWith("+") ? phone.slice(1) : phone;
    if (!digits) {
      throw new functions.https.HttpsError("permission-denied", "บัญชีนี้ไม่ใช่เจ้าของร้าน");
    }
    const phoneSnap = await db.collection("staffPhones").doc(digits).get();
    staffId = asString(phoneSnap.exists ? phoneSnap.get("staffId") : "", 120);
  }
  if (!staffId) {
    throw new functions.https.HttpsError("permission-denied", "บัญชีนี้ไม่ใช่เจ้าของร้าน");
  }
  const staffSnap = await db.collection("staff").doc(staffId).get();
  if (!staffSnap.exists || staffSnap.get("role") !== "owner") {
    throw new functions.https.HttpsError("permission-denied", "บัญชีนี้ไม่ใช่เจ้าของร้าน");
  }
  return { actorId: staffId };
}

async function loadOAuthConfig(db) {
  const envId = String(process.env.GMAIL_OAUTH_CLIENT_ID || "").trim();
  const envSecret = String(process.env.GMAIL_OAUTH_CLIENT_SECRET || "").trim();
  const envRedirect = String(process.env.GMAIL_OAUTH_REDIRECT_URI || "").trim();
  if (envId && envSecret && envRedirect) {
    return { clientId: envId, clientSecret: envSecret, redirectUri: envRedirect };
  }
  const snap = await db.doc(OAUTH_CONFIG_DOC).get();
  const data = snap.exists ? snap.data() : {};
  const clientId = asString(data.clientId, 200);
  const clientSecret = asString(data.clientSecret, 200);
  const redirectUri = asString(data.redirectUri, 400);
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

async function refreshAccessToken(config, refreshToken) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    const msg = json.error_description || json.error || `refresh failed (${res.status})`;
    throw new Error(msg);
  }
  return json.access_token;
}

function scopeHasDrive(scope) {
  return String(scope || "").includes("googleapis.com/auth/drive.file");
}

function bangkokDateKey(ms = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t) => parts.find((p) => p.type === t)?.value || "0";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function monthKeyFromReport(doc) {
  const periodMk = String(doc?.periodMonthKey || "").trim();
  if (/^\d{4}-\d{2}$/.test(periodMk)) return periodMk;
  const periodEnd = String(doc?.periodEnd || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(periodEnd)) return periodEnd.slice(0, 7);
  const guess = String(doc?.reportDateGuess || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(guess)) return guess.slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(guess)) return guess;
  const ms = Number(doc?.receivedAt) || Number(doc?.internalDate) || Date.now();
  return bangkokDateKey(ms).slice(0, 7);
}

function shiftMonthKey(monthKey, delta) {
  const m = String(monthKey || "");
  if (!/^\d{4}-\d{2}$/.test(m)) return "";
  const y = Number(m.slice(0, 4));
  const mo = Number(m.slice(5, 7));
  const idx = y * 12 + (mo - 1) + delta;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

function adjacentMonthKeys(monthKey) {
  return [
    shiftMonthKey(monthKey, -1),
    monthKey,
    shiftMonthKey(monthKey, 1),
  ].filter(Boolean);
}

/** ขอบเดือน ± pad วัน (Asia/Bangkok calendar) */
function monthWindowMs(monthKey, padDays = MONTH_OVERLAP_DAYS) {
  const [ys, ms] = String(monthKey).split("-").map(Number);
  if (!ys || !ms) return null;
  // Bangkok midnight ≈ UTC-7
  const startUtc = Date.UTC(ys, ms - 1, 1, 0, 0, 0) - 7 * 60 * 60 * 1000;
  const endUtc = Date.UTC(ys, ms, 1, 0, 0, 0) - 7 * 60 * 60 * 1000 - 1;
  const pad = Math.max(0, Number(padDays) || 0) * 24 * 60 * 60 * 1000;
  return { start: startUtc - pad, end: endUtc + pad };
}

/**
 * เมลคาบเกี่ยว: วันที่รายงานชี้เดือนเป้าหมาย หรือรับในช่วงขอบเดือน±pad
 * ของเดือนเป้าหมาย/เดือนก่อน-หลัง
 */
function reportTouchesMonth(doc, monthKey) {
  if (!monthKey) return true;
  const mk = monthKeyFromReport(doc);
  if (mk === monthKey) return true;
  if (!adjacentMonthKeys(monthKey).includes(mk)) return false;
  const win = monthWindowMs(monthKey, MONTH_OVERLAP_DAYS);
  if (!win) return false;
  const received = Number(doc?.receivedAt) || Number(doc?.internalDate) || 0;
  if (!received) return mk === monthKey;
  return received >= win.start && received <= win.end;
}

/**
 * เลือกโฟลเดอร์เดือน: วันที่รายงานมาก่อน · ถ้าคาบเกี่ยวและมี preferred ให้ใช้ preferred
 * เมื่อวันที่รายงานว่าง/อยู่เดือนข้างเคียงแต่รับในช่วงขอบ
 */
function resolveDriveMonthKey(doc, preferredMonth) {
  const fromPeriod = monthKeyFromReport(doc);
  if (/^\d{4}-\d{2}$/.test(fromPeriod)) {
    if (
      preferredMonth &&
      fromPeriod !== preferredMonth &&
      adjacentMonthKeys(preferredMonth).includes(fromPeriod)
    ) {
      // รายงานระบุเดือนก่อน/หลังชัด — เคารพช่วงในเนื้อ/period
      return fromPeriod;
    }
    return fromPeriod;
  }
  if (preferredMonth && reportTouchesMonth(doc, preferredMonth)) {
    return preferredMonth;
  }
  return fromPeriod;
}

function folderCacheKey(channel, monthKey) {
  return `${channel}/${monthKey}`;
}

async function driveCreateFolder(accessToken, name, parentId) {
  const body = {
    name,
    mimeType: "application/vnd.google-apps.folder",
  };
  if (parentId) body.parents = [parentId];
  const res = await fetch(
    "https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.id) {
    throw new Error(json.error?.message || `สร้างโฟลเดอร์ไม่สำเร็จ (${res.status})`);
  }
  return {
    id: String(json.id),
    name: String(json.name || name),
    webViewLink: String(json.webViewLink || ""),
  };
}

async function driveUploadFile(accessToken, { name, mimeType, buffer, parentId }) {
  const metadata = {
    name,
    parents: parentId ? [parentId] : undefined,
  };
  const boundary = `telltea_${Date.now().toString(36)}`;
  const metaPart =
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    `${JSON.stringify(metadata)}\r\n`;
  const binHead =
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType || "application/octet-stream"}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const body = Buffer.concat([
    Buffer.from(metaPart, "utf8"),
    Buffer.from(binHead, "utf8"),
    buffer,
    Buffer.from(tail, "utf8"),
  ]);
  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,size",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.id) {
    throw new Error(json.error?.message || `อัปโหลด Drive ไม่สำเร็จ (${res.status})`);
  }
  return {
    fileId: String(json.id),
    name: String(json.name || name),
    mimeType: String(json.mimeType || mimeType || ""),
    webViewLink: String(json.webViewLink || `https://drive.google.com/file/d/${json.id}/view`),
    size: Number(json.size) || buffer.length,
  };
}

async function getGmailMessage(accessToken, id) {
  const url =
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/` +
    `${encodeURIComponent(id)}?format=full`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error?.message || `get message failed (${res.status})`);
  }
  return json;
}

async function loadDriveMeta(db) {
  const snap = await db.doc(DRIVE_META_DOC).get();
  return snap.exists ? snap.data() || {} : {};
}

async function ensureDriveRoot(accessToken, db) {
  const meta = await loadDriveMeta(db);
  const existing = asString(meta.rootFolderId, 80);
  if (existing) {
    return {
      rootFolderId: existing,
      rootFolderName: asString(meta.rootFolderName, 80) || ROOT_FOLDER_NAME,
      folders: meta.folders && typeof meta.folders === "object" ? meta.folders : {},
      created: false,
    };
  }
  const folder = await driveCreateFolder(accessToken, ROOT_FOLDER_NAME, null);
  const next = {
    rootFolderId: folder.id,
    rootFolderName: ROOT_FOLDER_NAME,
    rootWebViewLink: folder.webViewLink || "",
    folders: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await db.doc(DRIVE_META_DOC).set(next, { merge: true });
  return {
    rootFolderId: folder.id,
    rootFolderName: ROOT_FOLDER_NAME,
    folders: {},
    created: true,
  };
}

/** กองรวมต่อแอพ — TellTea-VAT/{channel}/ (ยังไม่แยกเดือนบน Drive) */
async function ensureChannelFolder(accessToken, db, root, channel) {
  const channelKey = `${channel}/__root__`;
  const cached = asString(root.folders?.[channelKey], 80);
  if (cached) {
    return {
      folderId: cached,
      path: `${ROOT_FOLDER_NAME}/${channel}/`,
      created: false,
    };
  }

  const ch = await driveCreateFolder(accessToken, channel, root.rootFolderId);
  root.folders = { ...(root.folders || {}), [channelKey]: ch.id };
  await db.doc(DRIVE_META_DOC).set(
    {
      folders: root.folders,
      updatedAt: Date.now(),
    },
    { merge: true },
  );
  return {
    folderId: ch.id,
    path: `${ROOT_FOLDER_NAME}/${channel}/`,
    created: true,
  };
}

/** @deprecated ใช้ ensureChannelFolder — คงไว้กันเทสเก่า */
async function ensureChannelMonthFolder(accessToken, db, root, channel, _monthKey) {
  return ensureChannelFolder(accessToken, db, root, channel);
}

function alreadyUploaded(driveFiles, filename) {
  const name = String(filename || "");
  return (Array.isArray(driveFiles) ? driveFiles : []).some(
    (f) => String(f?.name || "") === name && String(f?.fileId || ""),
  );
}

function publicDriveStatus(oauthData, driveMeta) {
  const scope = asString(oauthData?.scope, 400);
  const hasDriveScope = scopeHasDrive(scope);
  const rootFolderId = asString(driveMeta?.rootFolderId, 80);
  return {
    hasDriveScope,
    rootFolderId,
    rootFolderName: asString(driveMeta?.rootFolderName, 80) || (rootFolderId ? ROOT_FOLDER_NAME : ""),
    rootWebViewLink: asString(driveMeta?.rootWebViewLink, 400),
    lastDriveSyncAt: Number(driveMeta?.lastSyncAt) || 0,
    lastDriveSyncUploaded: Number(driveMeta?.lastSyncUploaded) || 0,
    lastDriveSyncError: asString(driveMeta?.lastSyncError, 300),
    lastDriveSyncScanned: Number(driveMeta?.lastSyncScanned) || 0,
  };
}

/**
 * Owner sync: TellTea-VAT/{แอพ}/ กองรวม + อัปแนบจากแคตตาล็อกเมล
 * data.monthKey ถ้ามี = กรองเมล (optional) · ค่าเริ่มต้นอัปทุกเมลในแคตตาล็อกล่าสุด
 * ไฟล์ใหม่ลงกองแอพ — ไม่สร้างโฟลเดอร์เดือน
 */
exports.vatMailDriveSync = functions
  .region(REGION)
  .runWith({ timeoutSeconds: 300, memory: "1GB" })
  .https.onCall(async (data, context) => {
    const { actorId } = await assertOwner(context);
    const db = getFirestore();
    const config = await loadOAuthConfig(db);
    if (!config) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "ยังไม่ได้ตั้งค่า Gmail OAuth",
      );
    }
    const oauthSnap = await db.doc(OAUTH_DOC).get();
    if (!oauthSnap.exists || !oauthSnap.get("refreshToken")) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "ยังไม่ได้เชื่อม Gmail",
      );
    }
    const oauthData = oauthSnap.data() || {};
    if (!scopeHasDrive(oauthData.scope)) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "ยังไม่มีสิทธิ์ Drive — ตัดเชื่อมแล้วเชื่อม Gmail ใหม่ครั้งหนึ่ง",
      );
    }

    // กรองเดือนเฉพาะเมื่อส่ง filterByMonth: true — ค่าเริ่มต้นกองรวมทุกเมล
    const monthFilter = asString(data?.monthKey, 10);
    const filterByMonth = data?.filterByMonth === true && /^\d{4}-\d{2}$/.test(monthFilter);
    if (monthFilter && data?.filterByMonth === true && !/^\d{4}-\d{2}$/.test(monthFilter)) {
      throw new functions.https.HttpsError("invalid-argument", "monthKey ต้องเป็น YYYY-MM");
    }

    const refreshToken = asString(oauthData.refreshToken, 500);
    let uploaded = 0;
    let skipped = 0;
    let scanned = 0;
    let rootCreated = false;
    const errors = [];

    try {
      const accessToken = await refreshAccessToken(config, refreshToken);
      const root = await ensureDriveRoot(accessToken, db);
      rootCreated = root.created;

      const snap = await db
        .collection(REPORTS_COL)
        .orderBy("receivedAt", "desc")
        .limit(MAX_CATALOG_READ)
        .get();

      for (const docSnap of snap.docs) {
        if (scanned >= MAX_REPORTS_PER_SYNC) break;
        const doc = docSnap.data() || {};
        const channel = String(doc.channel || "");
        if (!CHANNELS.includes(channel)) {
          skipped += 1;
          continue;
        }
        if (filterByMonth && !reportTouchesMonth(doc, monthFilter)) continue;
        // เดือนในดัชนีเท่านั้น — ไม่ใช้แยกโฟลเดอร์ Drive
        const monthKey = resolveDriveMonthKey(doc, filterByMonth ? monthFilter : "");

        const messageId = asString(doc.messageId, 120);
        if (!messageId) {
          skipped += 1;
          continue;
        }

        const existingFiles = Array.isArray(doc.driveFiles) ? doc.driveFiles : [];
        scanned += 1;

        let msg;
        try {
          msg = await getGmailMessage(accessToken, messageId);
        } catch (e) {
          errors.push(`${docSnap.id}: ${asString(e?.message || String(e), 80)}`);
          skipped += 1;
          continue;
        }

        const parts = listDriveableParts(msg.payload).slice(0, MAX_FILES_PER_MESSAGE);
        if (!parts.length) {
          skipped += 1;
          continue;
        }

        const folder = await ensureChannelFolder(accessToken, db, root, channel);

        const nextFiles = [...existingFiles];
        let changed = false;

        for (const part of parts) {
          if (alreadyUploaded(nextFiles, part.filename)) {
            skipped += 1;
            continue;
          }
          try {
            let buf;
            if (part.inlineData) {
              buf = decodeAttachmentData(part.inlineData);
            } else {
              buf = await fetchAttachmentBuffer(
                accessToken,
                messageId,
                part.attachmentId,
              );
            }
            if (buf.length > MAX_ATTACH_BYTES) {
              errors.push(`${part.filename}: ไฟล์ใหญ่เกิน`);
              skipped += 1;
              continue;
            }
            const up = await driveUploadFile(accessToken, {
              name: part.filename,
              mimeType: part.mimeType,
              buffer: buf,
              parentId: folder.folderId,
            });
            nextFiles.push({
              fileId: up.fileId,
              name: up.name,
              mimeType: up.mimeType,
              webViewLink: up.webViewLink,
              folderId: folder.folderId,
              folderPath: folder.path,
              channel,
              monthKey,
              bytes: up.size,
              uploadedAt: Date.now(),
              sourceReportId: docSnap.id,
              sourceMessageId: messageId,
            });
            uploaded += 1;
            changed = true;
          } catch (e) {
            errors.push(
              `${part.filename}: ${asString(e?.message || String(e), 100)}`,
            );
          }
        }

        if (changed) {
          await db.collection(REPORTS_COL).doc(docSnap.id).set(
            {
              driveFiles: nextFiles.slice(0, 20),
              driveSyncedAt: Date.now(),
              driveSyncedBy: actorId,
            },
            { merge: true },
          );
        }
      }

      const driveStatus = {
        lastSyncAt: Date.now(),
        lastSyncError: errors.length ? errors[0] : "",
        lastSyncUploaded: uploaded,
        lastSyncScanned: scanned,
        lastSyncSkipped: skipped,
        updatedAt: Date.now(),
        updatedBy: actorId,
      };
      await db.doc(DRIVE_META_DOC).set(driveStatus, { merge: true });

      const meta = await loadDriveMeta(db);
      return {
        ok: true,
        uploaded,
        skipped,
        scanned,
        rootCreated,
        rootFolderId: asString(meta.rootFolderId, 80),
        rootWebViewLink: asString(meta.rootWebViewLink, 400),
        monthKey: filterByMonth ? monthFilter : "",
        pileMode: true,
        errors: errors.slice(0, 8),
        drive: publicDriveStatus(oauthData, meta),
      };
    } catch (e) {
      const msg = asString(e?.message || String(e), 300);
      await db.doc(DRIVE_META_DOC).set(
        {
          lastSyncAt: Date.now(),
          lastSyncError: msg,
          updatedAt: Date.now(),
        },
        { merge: true },
      );
      if (e instanceof functions.https.HttpsError) throw e;
      throw new functions.https.HttpsError(
        "internal",
        `ซิงก์ Drive ไม่สำเร็จ — ${msg.slice(0, 120)}`,
      );
    }
  });

exports.publicDriveStatus = publicDriveStatus;
exports.monthKeyFromReport = monthKeyFromReport;
exports.resolveDriveMonthKey = resolveDriveMonthKey;
exports.reportTouchesMonth = reportTouchesMonth;
exports.adjacentMonthKeys = adjacentMonthKeys;
exports.scopeHasDrive = scopeHasDrive;
exports.ensureChannelFolder = ensureChannelFolder;
exports.ensureChannelMonthFolder = ensureChannelMonthFolder;
exports.ROOT_FOLDER_NAME = ROOT_FOLDER_NAME;
exports.DRIVE_META_DOC = DRIVE_META_DOC;
