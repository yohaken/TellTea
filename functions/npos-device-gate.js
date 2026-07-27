/**
 * nPos store-claim gate — shared by sell / claim / heartbeat / owner commands.
 *
 * When meta/pos.storeClaimCodeHash is set, writes (sale/session/void/sold-out)
 * require: device exists, not blocked, holds exclusive seat (or claimed if
 * seatMode is not exclusive), and not emulator/dev when rejectDev.
 * Menu + shop settings reads stay open so the tablet can show the claim UI.
 */
const crypto = require("crypto");

const META_POS = "meta/pos";
const DEVICES = "posDevices";
const HASH_PREFIX = "telltea-store-claim:v1:";

function asString(v, max = 200) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

function normalizeStoreCode(code) {
  return asString(code, 32).toUpperCase().replace(/[\s\-]/g, "");
}

function hashStoreCode(code) {
  const n = normalizeStoreCode(code);
  if (!n || n.length < 4) return "";
  return crypto.createHash("sha256").update(HASH_PREFIX + n).digest("hex");
}

function isValidStoreCodeShape(code) {
  const n = normalizeStoreCode(code);
  return n.length >= 4 && n.length <= 16 && /^[A-Z0-9]+$/.test(n);
}

/**
 * @returns {Promise<{
 *   required: boolean,
 *   hash: string,
 *   rejectDev: boolean,
 *   updatedAt: number,
 *   seatMode: "exclusive" | "multi",
 *   activeSeatInstallId: string
 * }>}
 */
async function loadStoreClaimPolicy(db) {
  const snap = await db.doc(META_POS).get();
  const x = snap.exists ? snap.data() || {} : {};
  const hash = asString(x.storeClaimCodeHash, 80);
  const required = hash.length >= 32 && x.storeClaimRequired !== false;
  const rejectDev = x.storeClaimRejectDev !== false;
  // Default exclusive when gate is on (shop pilot). Explicit "multi" keeps old behavior.
  const seatMode = x.seatMode === "multi" ? "multi" : "exclusive";
  const activeSeatInstallId = asString(x.activeSeatInstallId, 64);
  return {
    required,
    hash,
    rejectDev,
    updatedAt: typeof x.storeClaimUpdatedAt === "number" ? x.storeClaimUpdatedAt : 0,
    seatMode,
    activeSeatInstallId,
  };
}

function deviceIsBlocked(data) {
  if (!data) return false;
  return data.blocked === true || data.deviceClass === "blocked";
}

function deviceIsDev(data) {
  if (!data) return false;
  if (data.isEmulator === true) return true;
  if (data.deviceClass === "dev") return true;
  const hint = asString(data.deviceHint, 120);
  return /sdk|emulator|generic|goldfish|ranchu/i.test(hint);
}

function deviceIsClaimed(data) {
  return data && data.storeClaimed === true;
}

function isExclusive(policy) {
  return policy && policy.seatMode !== "multi";
}

/**
 * @returns {Promise<{
 *   ok: boolean,
 *   error?: string,
 *   code?: string,
 *   required: boolean,
 *   claimed: boolean,
 *   blocked: boolean,
 *   isDev: boolean,
 *   seatHeldByMe: boolean,
 *   seatTaken: boolean,
 *   kicked: boolean,
 *   device?: object
 * }>}
 */
async function assertNposDeviceAllowed(db, installId) {
  const policy = await loadStoreClaimPolicy(db);
  const ref = db.collection(DEVICES).doc(installId);
  const snap = await ref.get();
  const data = snap.exists ? snap.data() || {} : null;
  const blocked = deviceIsBlocked(data);
  const isDev = deviceIsDev(data);
  const claimed = deviceIsClaimed(data);
  const exclusive = isExclusive(policy);
  const seatHeldByMe =
    exclusive && policy.required
      ? policy.activeSeatInstallId === installId
      : claimed;
  const seatTaken =
    exclusive &&
    policy.required &&
    !!policy.activeSeatInstallId &&
    policy.activeSeatInstallId !== installId;
  const kicked =
    exclusive &&
    policy.required &&
    data &&
    data.storeClaimMethod === "revoked" &&
    !seatHeldByMe;

  const base = {
    required: policy.required,
    claimed,
    blocked,
    isDev,
    seatHeldByMe,
    seatTaken,
    kicked,
    device: data || undefined,
  };

  if (blocked) {
    return { ok: false, error: "เครื่องนี้ถูกบล็อกจากหลังบ้าน", code: "device_blocked", ...base };
  }

  if (!policy.required) {
    return { ok: true, ...base };
  }

  if (!snap.exists) {
    return {
      ok: false,
      error: "เครื่องยังไม่ได้ลงทะเบียน — เปิดแอปให้ออนไลน์ก่อน",
      code: "device_unknown",
      ...base,
    };
  }

  if (exclusive) {
    if (!seatHeldByMe) {
      if (seatTaken) {
        return {
          ok: false,
          error: "มีเครื่องอื่นใช้อยู่ — ให้หลังบ้านเตะเครื่องนั้นก่อน หรือรอว่าง",
          code: "seat_taken",
          ...base,
        };
      }
      if (kicked) {
        return {
          ok: false,
          error: "ถูกถอนสิทธิ์จากหลังบ้าน — กรอกรหัสร้านใหม่",
          code: "device_kicked",
          ...base,
        };
      }
      return {
        ok: false,
        error: "กรอกรหัสร้านเพื่อเคลมเครื่องก่อนขาย",
        code: "device_not_claimed",
        ...base,
      };
    }
  } else if (!claimed) {
    return {
      ok: false,
      error: "กรอกรหัสร้านเพื่อเคลมเครื่องก่อนขาย",
      code: "device_not_claimed",
      ...base,
    };
  }

  if (policy.rejectDev && isDev) {
    return {
      ok: false,
      error: "เครื่องจำลอง/พัฒนาถูกปิดกั้นช่วงทดลองหน้าร้าน",
      code: "device_dev_rejected",
      ...base,
    };
  }

  return { ok: true, ...base };
}

async function claimStatusForHeartbeat(db, installId, deviceData) {
  const policy = await loadStoreClaimPolicy(db);
  const exclusive = isExclusive(policy);
  const claimed = deviceIsClaimed(deviceData);
  const seatHeldByMe =
    exclusive && policy.required
      ? policy.activeSeatInstallId === installId
      : claimed;
  const seatTaken =
    exclusive &&
    policy.required &&
    !!policy.activeSeatInstallId &&
    policy.activeSeatInstallId !== installId;
  const kicked =
    exclusive &&
    policy.required &&
    deviceData &&
    deviceData.storeClaimMethod === "revoked" &&
    !seatHeldByMe;

  return {
    storeClaimRequired: policy.required,
    storeClaimed: seatHeldByMe || (!exclusive && claimed),
    storeClaimRejectDev: policy.rejectDev,
    deviceBlocked: deviceIsBlocked(deviceData),
    deviceIsDev: deviceIsDev(deviceData),
    seatMode: policy.seatMode,
    activeSeatInstallId: policy.activeSeatInstallId || "",
    seatHeldByMe,
    seatTaken,
    kicked,
  };
}

module.exports = {
  META_POS,
  DEVICES,
  normalizeStoreCode,
  hashStoreCode,
  isValidStoreCodeShape,
  loadStoreClaimPolicy,
  assertNposDeviceAllowed,
  claimStatusForHeartbeat,
  deviceIsBlocked,
  deviceIsClaimed,
  deviceIsDev,
  isExclusive,
};
