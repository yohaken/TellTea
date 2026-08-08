import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { POS_BUILD } from "./pos-version";
import { collectPosDeviceTelemetry, type PosDeviceTelemetry } from "./pos-device-telemetry";
import { getPosDb } from "./pos-firebase";
import { getDb, getFirebaseFunctions } from "./firebase";
import { mapFirestoreError } from "./firestore-errors";
import type { PosNativeUpdateStatus, PosShellKind } from "./pos-native-version";

type OwnerDeviceAction =
  | "capture"
  | "capture_interval"
  | "block"
  | "unblock"
  | "clear_captures"
  | "clear_captures_all"
  | "purge_dev_devices"
  | "set_store_code"
  | "clear_store_code"
  | "get_store_claim"
  | "clear_seat"
  | "grant_claim"
  | "revoke_claim";

type OwnerDeviceCommandResult = {
  ok: boolean;
  deleted?: number;
  deletedDevices?: number;
  deletedDiagnose?: number;
  deletedOps?: number;
  deletedSessions?: number;
  deletedSales?: number;
  deletedMutations?: number;
  deletedShots?: number;
  shopKept?: number;
  revokedCount?: number;
  storeClaimRequired?: boolean;
  hasCode?: boolean;
  codeHint?: string;
  storeClaimCode?: string;
  storeClaimRejectDev?: boolean;
  storeClaimUpdatedAt?: number;
  seatMode?: "exclusive" | "multi" | string;
  activeSeatInstallId?: string;
  keepPairingCode?: string;
  keptIds?: string[];
};

async function callNposOwnerDeviceCommand(
  action: OwnerDeviceAction,
  deviceId?: string,
  extra?: Record<string, unknown>,
): Promise<OwnerDeviceCommandResult> {
  const fn = httpsCallable<
    { action: OwnerDeviceAction; deviceId?: string } & Record<string, unknown>,
    OwnerDeviceCommandResult
  >(getFirebaseFunctions(), "nposOwnerDeviceCommand");
  try {
    const shopWide =
      action === "clear_captures_all" ||
      action === "purge_dev_devices" ||
      action === "set_store_code" ||
      action === "clear_store_code" ||
      action === "get_store_claim" ||
      action === "clear_seat";
    const payload = shopWide
      ? { action, ...(extra || {}) }
      : { action, deviceId, ...(extra || {}) };
    const res = await fn(payload);
    return res.data || { ok: true };
  } catch (err) {
    const code = String((err as { code?: string })?.code || "");
    const msg = String((err as Error)?.message || err);
    if (code.includes("permission-denied") || /permission|สิทธิ์/i.test(msg)) {
      throw new Error(
        mapFirestoreError(
          { code: "permission-denied", message: msg },
          action === "capture"
            ? "สั่งแคปจอ nPos"
            : action === "capture_interval"
              ? "ตั้งช่วงแคปจอ nPos"
              : action === "clear_captures" || action === "clear_captures_all"
                ? "ล้างภาพแคป nPos"
                : action === "purge_dev_devices"
                  ? "ลบเครื่องพัฒนา/emulator"
                  : action === "block"
                    ? "บล็อกเครื่อง nPos"
                    : action === "set_store_code" || action === "clear_store_code"
                      ? "ตั้งรหัสร้าน"
                      : action === "grant_claim" || action === "revoke_claim"
                        ? "จัดการเคลมเครื่อง"
                        : "ปลดบล็อกเครื่อง nPos",
          "staff",
        ),
      );
    }
    if (code.includes("not-found") || /ไม่พบเครื่อง/i.test(msg)) {
      throw new Error("ไม่พบเครื่องนี้ในระบบ — รอเครื่องส่งสัญญาณอีกครั้ง");
    }
    throw new Error(msg || "สั่งงานเครื่อง nPos ไม่สำเร็จ");
  }
}
export const POS_DEVICES_COL = "posDevices";
export const POS_HEARTBEAT_MS = 60 * 1000;
export const POS_ONLINE_MS = 5 * 60 * 1000;

export type PosDevice = {
  id: string;
  authUid: string;
  label: string;
  pairingCode: string;
  registeredAt: number;
  lastSeenAt: number;
  appBuild: number;
  /** Native client semver from heartbeat (e.g. 1.14.66). */
  versionName: string;
  userAgent: string;
  forceReloadAt: number;
  lastReloadAckAt: number;
  disabled: boolean;
  syncPendingCount: number;
  syncFailedCount: number;
  syncStuckAt: number;
  syncLastError: string;
  deviceHint: string;
  printerLabel: string;
  /** nPos paper preference / Sunmi getPrinterPaper sync — 58 or 80. */
  paperWidthMm: 58 | 80 | 0;
  /** Esc/POS column count used for slip layout (32/42…). */
  receiptCols: number;
  printerReady: boolean;
  /** Cash drawer via receipt printer — true when printer endpoint is ready. */
  drawerReady: boolean;
  standalone: boolean;
  screenSize: string;
  platform: string;
  telemetryAt: number;
  /** native | pwa | browser */
  shellKind: PosShellKind | "";
  /** เลข APK Capacitor — 0 ถ้าไม่ใช่ native */
  nativeShellBuild: number;
  updateStatus: PosNativeUpdateStatus | "";
  updateTargetBuild: number;
  updateError: string;
  updateCheckedAt: number;
  /** เจ้าของสั่งทดสอบส่งข้อความมาเครื่อง */
  ownerPingAt: number;
  ownerPingMessage: string;
  lastOwnerPingAckAt: number;
  /** ANDROID_ID (or empty) — used to hide reinstall ghosts for the same tablet. */
  stableKey: string;
  /** Emulator / AVD heuristic from native client. */
  isEmulator: boolean;
  /** shop | dev | blocked — BO folds + hide accidental installs. */
  deviceClass: string;
  /** Explicit BO block flag (survives heartbeat). */
  blocked: boolean;
  /** Half-login: entered store code or owner grant. */
  storeClaimed: boolean;
  storeClaimedAt: number;
  storeClaimMethod: string;
  storeClaimRevokeReason: string;
  /** ok | missing | unknown — customer / secondary display. */
  customerDisplay: string;
  captureRequestAt: number;
  lastCaptureAckAt: number;
  lastCaptureAt: number;
  /** 0 = off; else minutes between automatic captures while app is open. */
  captureIntervalMinutes: number;
  /** Native runtime + install grants reported by tablet. */
  permissionsOk: boolean;
  permissionsStatus: string;
  /** Latest capture download URLs (from reportNposScreenCapture). */
  latestPrimaryUrl: string;
  latestSecondaryUrl: string;
};

function deviceRef(id: string) {
  return doc(getPosDb(), POS_DEVICES_COL, id);
}

function devicesCol() {
  return collection(getPosDb(), POS_DEVICES_COL);
}

export function posPairingCodeFromId(id: string): string {
  return id.replace(/-/g, "").slice(-6).toUpperCase();
}

export function posDeviceLabel(device: PosDevice): string {
  return device.label.trim() || `เครื่อง ${device.pairingCode}`;
}

/** Semver from heartbeat field, else parse `nPos-telltea/1.14.66` userAgent. */
export function posClientVersionName(device: PosDevice): string {
  const named = (device.versionName || "").trim();
  if (named && named !== "0") return named;
  const ua = (device.userAgent || "").trim();
  const m = /^nPos-telltea\/(.+)$/i.exec(ua);
  if (m?.[1]?.trim() && m[1].trim() !== "0") return m[1].trim();
  return "";
}

/** Client version as minor+code — e.g. `1.14.66 (89)` (not build-only). */
export function posClientVersionLabel(device: PosDevice): string {
  const name = posClientVersionName(device);
  const code = device.nativeShellBuild || device.appBuild || 0;
  if (name && code > 0) return `${name} (${code})`;
  if (name) return name;
  if (code > 0) return String(code);
  return "—";
}

export type PosEquipState = "ready" | "missing" | "unknown";

function equipMark(ready: boolean, known: boolean): PosEquipState {
  if (ready) return "ready";
  if (known) return "missing";
  return "unknown";
}

function equipGlyph(state: PosEquipState): string {
  if (state === "ready") return "✓";
  if (state === "missing") return "×";
  return "—";
}

function equipWord(state: PosEquipState): string {
  if (state === "ready") return "พร้อม";
  if (state === "missing") return "ยัง";
  return "—";
}

/** Printer / drawer / customer-display readiness for BO table. */
export function posDeviceEquipment(device: PosDevice): {
  printer: PosEquipState;
  drawer: PosEquipState;
  customerDisplay: PosEquipState;
  short: string;
  title: string;
} {
  const knownHw =
    device.shellKind === "native" ||
    device.telemetryAt > 0 ||
    !!device.printerLabel ||
    device.appBuild > 0;
  const printer = equipMark(device.printerReady, knownHw);
  const drawer = equipMark(device.drawerReady || device.printerReady, knownHw);
  const cdRaw = (device.customerDisplay || "").toLowerCase();
  let customerDisplay: PosEquipState = "unknown";
  if (cdRaw === "ok" || cdRaw === "ready") customerDisplay = "ready";
  else if (cdRaw === "missing" || cdRaw === "none") customerDisplay = "missing";
  else if (cdRaw && cdRaw !== "unknown") customerDisplay = "missing";
  else if (knownHw) customerDisplay = "unknown";

  const short = `พ${equipGlyph(printer)} ล${equipGlyph(drawer)} จ${equipGlyph(customerDisplay)}`;
  const printerBit = device.printerLabel
    ? `พิมพ์ ${equipWord(printer)} (${device.printerLabel})`
    : `พิมพ์ ${equipWord(printer)}`;
  const title = [
    printerBit,
    `ลิ้นชัก ${equipWord(drawer)}${device.printerReady ? " · พ่วงปริ้น" : ""}`,
    `จอลูกค้า ${
      customerDisplay === "ready" ? "มี" : customerDisplay === "missing" ? "ไม่มี" : "—"
    }`,
  ].join(" · ");
  return { printer, drawer, customerDisplay, short, title };
}

export function isPosDeviceOnline(lastSeenAt: number, now = Date.now()): boolean {
  return lastSeenAt > 0 && now - lastSeenAt <= POS_ONLINE_MS;
}

export type PosConnectivityPill = "online" | "offline-net" | "offline-signal";

export function getPosConnectivity(
  lastSeenAt: number,
  localHeartbeatAt: number,
  netOnline: boolean,
  now = Date.now(),
  booting = false,
): { deviceOnline: boolean; pill: PosConnectivityPill; label: string } {
  if (booting) {
    return { deviceOnline: false, pill: "offline-signal", label: "กำลังเชื่อม" };
  }

  const seenAt = Math.max(lastSeenAt, localHeartbeatAt);
  const deviceOnline = isPosDeviceOnline(seenAt, now);

  if (deviceOnline && netOnline) {
    return { deviceOnline, pill: "online", label: "ออน" };
  }
  if (!netOnline) {
    return { deviceOnline, pill: "offline-net", label: "เน็ตออฟ" };
  }
  return { deviceOnline, pill: "offline-signal", label: "รอสัญญาณ" };
}

function mapPosDeviceDoc(id: string, data: Record<string, unknown>): PosDevice {
  const shellKindRaw = typeof data.shellKind === "string" ? data.shellKind : "";
  const shellKind =
    shellKindRaw === "native" || shellKindRaw === "pwa" || shellKindRaw === "browser"
      ? shellKindRaw
      : "";
  const updateStatusRaw = typeof data.updateStatus === "string" ? data.updateStatus : "";
  const updateStatus = (
    ["idle", "available", "downloading", "installing", "ready", "failed"] as const
  ).includes(updateStatusRaw as PosNativeUpdateStatus)
    ? (updateStatusRaw as PosNativeUpdateStatus)
    : "";

  return {
    id,
    authUid: typeof data.authUid === "string" ? data.authUid : id,
    label: typeof data.label === "string" ? data.label : "",
    pairingCode:
      typeof data.pairingCode === "string" ? data.pairingCode : posPairingCodeFromId(id),
    registeredAt: typeof data.registeredAt === "number" ? data.registeredAt : 0,
    lastSeenAt: typeof data.lastSeenAt === "number" ? data.lastSeenAt : 0,
    appBuild: typeof data.appBuild === "number" ? data.appBuild : 0,
    versionName: (() => {
      if (typeof data.versionName === "string" && data.versionName.trim()) {
        return data.versionName.trim();
      }
      const ua = typeof data.userAgent === "string" ? data.userAgent.trim() : "";
      const m = /^nPos-telltea\/(.+)$/i.exec(ua);
      return m?.[1]?.trim() || "";
    })(),
    userAgent: typeof data.userAgent === "string" ? data.userAgent : "",
    forceReloadAt: typeof data.forceReloadAt === "number" ? data.forceReloadAt : 0,
    lastReloadAckAt: typeof data.lastReloadAckAt === "number" ? data.lastReloadAckAt : 0,
    disabled: data.disabled === true,
    syncPendingCount: typeof data.syncPendingCount === "number" ? data.syncPendingCount : 0,
    syncFailedCount: typeof data.syncFailedCount === "number" ? data.syncFailedCount : 0,
    syncStuckAt: typeof data.syncStuckAt === "number" ? data.syncStuckAt : 0,
    syncLastError: typeof data.syncLastError === "string" ? data.syncLastError : "",
    deviceHint: typeof data.deviceHint === "string" ? data.deviceHint : "",
    printerLabel: typeof data.printerLabel === "string" ? data.printerLabel : "",
    paperWidthMm: data.paperWidthMm === 58 ? 58 : data.paperWidthMm === 80 ? 80 : 0,
    receiptCols:
      typeof data.receiptCols === "number" && Number.isFinite(data.receiptCols)
        ? Math.floor(data.receiptCols)
        : 0,
    printerReady: data.printerReady === true,
    drawerReady:
      typeof data.drawerReady === "boolean"
        ? data.drawerReady === true
        : data.printerReady === true,
    standalone: data.standalone === true,
    screenSize: typeof data.screenSize === "string" ? data.screenSize : "",
    platform: typeof data.platform === "string" ? data.platform : "",
    telemetryAt: typeof data.telemetryAt === "number" ? data.telemetryAt : 0,
    shellKind,
    nativeShellBuild: typeof data.nativeShellBuild === "number" ? data.nativeShellBuild : 0,
    updateStatus,
    updateTargetBuild: typeof data.updateTargetBuild === "number" ? data.updateTargetBuild : 0,
    updateError: typeof data.updateError === "string" ? data.updateError : "",
    updateCheckedAt: typeof data.updateCheckedAt === "number" ? data.updateCheckedAt : 0,
    ownerPingAt: typeof data.ownerPingAt === "number" ? data.ownerPingAt : 0,
    ownerPingMessage: typeof data.ownerPingMessage === "string" ? data.ownerPingMessage : "",
    lastOwnerPingAckAt: typeof data.lastOwnerPingAckAt === "number" ? data.lastOwnerPingAckAt : 0,
    stableKey: typeof data.stableKey === "string" ? data.stableKey : "",
    isEmulator: data.isEmulator === true,
    deviceClass: typeof data.deviceClass === "string" ? data.deviceClass : "",
    blocked: data.blocked === true || data.deviceClass === "blocked",
    storeClaimed: data.storeClaimed === true,
    storeClaimedAt: typeof data.storeClaimedAt === "number" ? data.storeClaimedAt : 0,
    storeClaimMethod: typeof data.storeClaimMethod === "string" ? data.storeClaimMethod : "",
    storeClaimRevokeReason:
      typeof data.storeClaimRevokeReason === "string" ? data.storeClaimRevokeReason : "",
    customerDisplay: typeof data.customerDisplay === "string" ? data.customerDisplay : "",
    captureRequestAt: typeof data.captureRequestAt === "number" ? data.captureRequestAt : 0,
    lastCaptureAckAt: typeof data.lastCaptureAckAt === "number" ? data.lastCaptureAckAt : 0,
    lastCaptureAt: typeof data.lastCaptureAt === "number" ? data.lastCaptureAt : 0,
    captureIntervalMinutes:
      typeof data.captureIntervalMinutes === "number" ? data.captureIntervalMinutes : 0,
    permissionsOk: data.permissionsOk === true,
    permissionsStatus: typeof data.permissionsStatus === "string" ? data.permissionsStatus : "",
    latestPrimaryUrl: typeof data.latestPrimaryUrl === "string" ? data.latestPrimaryUrl : "",
    latestSecondaryUrl:
      typeof data.latestSecondaryUrl === "string" ? data.latestSecondaryUrl : "",
  };
}

/** Fill stableKey from installId when older docs omitted it (npos + ANDROID_ID). */
export function withResolvedStableKey(device: PosDevice): PosDevice {
  if (device.stableKey && device.stableKey.length >= 8) return device;
  const compact = device.id.replace(/-/g, "").toLowerCase();
  const m = /^npos([a-f0-9]+)$/.exec(compact);
  if (!m) return device;
  const hex = m[1];
  if (hex.length < 8 || hex.length > 20) return device;
  return { ...device, stableKey: hex };
}

function telemetryPatch(telemetry?: PosDeviceTelemetry): Record<string, unknown> {
  const t = telemetry ?? collectPosDeviceTelemetry();
  return {
    deviceHint: t.deviceHint,
    printerLabel: t.printerLabel,
    printerReady: t.printerReady,
    standalone: t.standalone,
    screenSize: t.screenSize,
    platform: t.platform,
    shellKind: t.shellKind,
    nativeShellBuild: t.nativeShellBuild,
    telemetryAt: Date.now(),
  };
}

export async function registerPosDevice(authUid: string): Promise<PosDevice> {
  const now = Date.now();
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const pairingCode = posPairingCodeFromId(authUid);

  const patch = {
    authUid,
    pairingCode,
    lastSeenAt: now,
    appBuild: POS_BUILD,
    userAgent: ua,
    ...telemetryPatch(),
  };

  try {
    await setDoc(deviceRef(authUid), patch, { merge: true });
  } catch (err) {
    throw new Error(mapFirestoreError(err, "ลงทะเบียนเครื่อง POS", "pos"));
  }

  return mapPosDeviceDoc(authUid, {
    ...patch,
    label: "",
    registeredAt: now,
    forceReloadAt: 0,
    lastReloadAckAt: 0,
    disabled: false,
    syncPendingCount: 0,
    syncFailedCount: 0,
    syncStuckAt: 0,
    syncLastError: "",
  });
}

/** Instant UI while server round-trip runs in background. */
export function optimisticPosDevice(authUid: string): PosDevice {
  const now = Date.now();
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const pairingCode = posPairingCodeFromId(authUid);
  return mapPosDeviceDoc(authUid, {
    authUid,
    label: "",
    pairingCode,
    registeredAt: now,
    lastSeenAt: now,
    appBuild: POS_BUILD,
    userAgent: ua,
    forceReloadAt: 0,
    lastReloadAckAt: 0,
    disabled: false,
    syncPendingCount: 0,
    syncFailedCount: 0,
    syncStuckAt: 0,
    syncLastError: "",
    ...telemetryPatch(),
  });
}

export async function heartbeatPosDevice(authUid: string): Promise<void> {
  const now = Date.now();
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  try {
    await setDoc(
      deviceRef(authUid),
      {
        authUid,
        lastSeenAt: now,
        appBuild: POS_BUILD,
        userAgent: ua,
        ...telemetryPatch(),
      },
      { merge: true },
    );
  } catch (err) {
    throw new Error(mapFirestoreError(err, "ส่งสัญญาณเครื่อง POS", "pos"));
  }
}

export type PosDeviceSyncStatus = {
  syncPendingCount: number;
  syncFailedCount: number;
  syncStuckAt: number;
  syncLastError: string;
};

export async function reportPosDeviceSyncStatus(
  authUid: string,
  status: PosDeviceSyncStatus,
): Promise<void> {
  try {
    await setDoc(
      deviceRef(authUid),
      {
        authUid,
        syncPendingCount: Math.max(0, status.syncPendingCount),
        syncFailedCount: Math.max(0, status.syncFailedCount),
        syncStuckAt: Math.max(0, status.syncStuckAt),
        syncLastError: status.syncLastError || "",
        updatedAt: Date.now(),
      },
      { merge: true },
    );
  } catch (err) {
    throw new Error(mapFirestoreError(err, "รายงานสถานะ sync POS", "pos"));
  }
}


export async function reportPosDeviceNativeUpdate(
  authUid: string,
  status: {
    updateStatus: PosNativeUpdateStatus;
    updateTargetBuild?: number;
    updateError?: string;
  },
): Promise<void> {
  try {
    await setDoc(
      deviceRef(authUid),
      {
        authUid,
        updateStatus: status.updateStatus,
        updateTargetBuild: Math.max(0, status.updateTargetBuild ?? 0),
        updateError: status.updateError || "",
        updateCheckedAt: Date.now(),
        ...telemetryPatch(),
      },
      { merge: true },
    );
  } catch (err) {
    throw new Error(mapFirestoreError(err, "รายงานสถานะอัปเดต APK", "pos"));
  }
}

export async function ackPosDeviceReload(authUid: string, forceReloadAt: number): Promise<void> {
  try {
    await setDoc(
      deviceRef(authUid),
      {
        lastReloadAckAt: forceReloadAt,
      },
      { merge: true },
    );
  } catch (err) {
    throw new Error(mapFirestoreError(err, "ยืนยันรีเฟรชเครื่อง POS", "pos"));
  }
}

export async function savePosDeviceLabel(
  deviceId: string,
  label: string,
  updatedBy: string,
): Promise<void> {
  try {
    await setDoc(
      deviceRef(deviceId),
      {
        label: label.trim(),
        updatedAt: Date.now(),
        updatedBy,
      },
      { merge: true },
    );
  } catch (err) {
    throw new Error(mapFirestoreError(err, "บันทึกชื่อเครื่อง POS", "pos"));
  }
}

/**
 * Owner: hide accidental / stray installs from shop view.
 * Blocked survives native heartbeat (CF preserves deviceClass=blocked).
 * Goes through Admin CF so BO never hits client rule friction.
 */
export async function setNposDeviceBlocked(
  deviceId: string,
  blocked: boolean,
  _updatedBy: string,
  opts?: { isEmulator?: boolean },
): Promise<void> {
  await callNposOwnerDeviceCommand(blocked ? "block" : "unblock", deviceId, {
    isEmulator: opts?.isEmulator === true,
  });
}

export async function getNposStoreClaimStatus(): Promise<{
  storeClaimRequired: boolean;
  hasCode: boolean;
  storeClaimRejectDev: boolean;
  storeClaimUpdatedAt: number;
  seatMode: "exclusive" | "multi";
  activeSeatInstallId: string;
  /** Full shop code for owner BO recall (empty if set before this field). */
  storeClaimCode: string;
}> {
  const res = await callNposOwnerDeviceCommand("get_store_claim");
  return {
    storeClaimRequired: res.storeClaimRequired === true,
    hasCode: res.hasCode === true,
    storeClaimRejectDev: res.storeClaimRejectDev !== false,
    storeClaimUpdatedAt: typeof res.storeClaimUpdatedAt === "number" ? res.storeClaimUpdatedAt : 0,
    seatMode: res.seatMode === "multi" ? "multi" : "exclusive",
    activeSeatInstallId:
      typeof res.activeSeatInstallId === "string" ? res.activeSeatInstallId : "",
    storeClaimCode:
      typeof res.storeClaimCode === "string" ? res.storeClaimCode.trim().toUpperCase() : "",
  };
}

export async function setNposStoreClaimCode(
  storeCode: string,
  opts?: { rejectDev?: boolean },
): Promise<{ codeHint: string; revokedCount: number }> {
  const res = await callNposOwnerDeviceCommand("set_store_code", undefined, {
    storeCode,
    rejectDev: opts?.rejectDev !== false,
  });
  return {
    codeHint: res.codeHint || "••••",
    revokedCount: typeof res.revokedCount === "number" ? res.revokedCount : 0,
  };
}

export async function clearNposStoreClaimCode(): Promise<void> {
  await callNposOwnerDeviceCommand("clear_store_code");
}

/** Kick every claimed tablet + clear exclusive seat so a new login can start. */
export async function clearNposExclusiveSeat(): Promise<{ revokedCount: number }> {
  const res = await callNposOwnerDeviceCommand("clear_seat");
  return { revokedCount: typeof res.revokedCount === "number" ? res.revokedCount : 0 };
}

/** Shop emp tablet pairing code — SUNMI D2s counter. */
export const NPOS_SHOP_KEEP_PAIRING_CODE = "570F0F";

/** Owner: wipe every device/bill/log except keepPairingCode (default 570F0F). */
export async function purgeNposDevDevices(opts?: {
  keepPairingCode?: string;
}): Promise<{
  deletedDevices: number;
  deletedDiagnose: number;
  deletedOps: number;
  deletedSessions: number;
  deletedSales: number;
  deletedMutations: number;
  deletedShots: number;
  shopKept: number;
  keepPairingCode: string;
  keptIds: string[];
}> {
  const keepPairingCode = (opts?.keepPairingCode || NPOS_SHOP_KEEP_PAIRING_CODE)
    .trim()
    .toUpperCase();
  const res = await callNposOwnerDeviceCommand("purge_dev_devices", undefined, {
    keepPairingCode,
  });
  return {
    deletedDevices: typeof res.deletedDevices === "number" ? res.deletedDevices : 0,
    deletedDiagnose: typeof res.deletedDiagnose === "number" ? res.deletedDiagnose : 0,
    deletedOps: typeof res.deletedOps === "number" ? res.deletedOps : 0,
    deletedSessions: typeof res.deletedSessions === "number" ? res.deletedSessions : 0,
    deletedSales: typeof res.deletedSales === "number" ? res.deletedSales : 0,
    deletedMutations: typeof res.deletedMutations === "number" ? res.deletedMutations : 0,
    deletedShots: typeof res.deletedShots === "number" ? res.deletedShots : 0,
    shopKept: typeof res.shopKept === "number" ? res.shopKept : 0,
    keepPairingCode:
      typeof res.keepPairingCode === "string" ? res.keepPairingCode : keepPairingCode,
    keptIds: Array.isArray(res.keptIds) ? res.keptIds.map(String) : [],
  };
}

export async function setNposDeviceStoreClaimed(
  deviceId: string,
  claimed: boolean,
  opts?: { isEmulator?: boolean },
): Promise<void> {
  await callNposOwnerDeviceCommand(claimed ? "grant_claim" : "revoke_claim", deviceId, {
    isEmulator: opts?.isEmulator === true,
  });
}

/** Owner: ask tablet to capture primary + secondary screens on next heartbeat. */
export async function requestNposScreenCapture(
  deviceId: string,
  _updatedBy: string,
): Promise<void> {
  await callNposOwnerDeviceCommand("capture", deviceId);
}

/** Owner: 0 = off, else capture every N minutes while app is open. */
export async function setNposCaptureInterval(
  deviceId: string,
  intervalMinutes: number,
  _updatedBy: string,
): Promise<void> {
  const allowed = new Set([0, 5, 10, 30]);
  const mins = allowed.has(intervalMinutes) ? intervalMinutes : 0;
  await callNposOwnerDeviceCommand("capture_interval", deviceId, {
    intervalMinutes: mins,
  });
}

/** Owner: delete all capture images for one device (Storage + Firestore). */
export async function clearNposDeviceCaptures(
  deviceId: string,
  _updatedBy: string,
): Promise<number> {
  const res = await callNposOwnerDeviceCommand("clear_captures", deviceId);
  return typeof res.deleted === "number" ? res.deleted : 0;
}

/** Owner: delete every nPos capture in the shop. */
export async function clearAllNposCaptures(_updatedBy: string): Promise<number> {
  const res = await callNposOwnerDeviceCommand("clear_captures_all", "");
  return typeof res.deleted === "number" ? res.deleted : 0;
}

export async function requestPosDeviceReload(
  deviceId: string,
  updatedBy: string,
): Promise<void> {
  try {
    await setDoc(
      deviceRef(deviceId),
      {
        forceReloadAt: Date.now(),
        updatedAt: Date.now(),
        updatedBy,
      },
      { merge: true },
    );
  } catch (err) {
    throw new Error(mapFirestoreError(err, "สั่งรีเฟรชเครื่อง POS", "pos"));
  }
}

/** เจ้าของทดสอบช่องทาง: เครื่องแสดงป๊อปทันที โดยไม่รีโหลด (ปลอดภัยตอนขาย) */
export async function requestPosDeviceOwnerPing(
  deviceId: string,
  updatedBy: string,
  message?: string,
): Promise<void> {
  try {
    await setDoc(
      deviceRef(deviceId),
      {
        ownerPingAt: Date.now(),
        ownerPingMessage:
          (message || "").trim() ||
          "ถ้าเห็นข้อความนี้ ให้ทักบอกพี่ หรือถ่ายรูปหน้าจอนี้ส่งมา — แปลว่าระบบอัปเดตจากร้านทำงานแล้ว",
        updatedAt: Date.now(),
        updatedBy,
      },
      { merge: true },
    );
  } catch (err) {
    throw new Error(mapFirestoreError(err, "ทดสอบส่งไปเครื่อง POS", "pos"));
  }
}

export async function ackPosDeviceOwnerPing(
  authUid: string,
  ownerPingAt: number,
): Promise<void> {
  try {
    await setDoc(
      deviceRef(authUid),
      {
        authUid,
        lastOwnerPingAckAt: ownerPingAt,
        updatedAt: Date.now(),
      },
      { merge: true },
    );
  } catch (err) {
    throw new Error(mapFirestoreError(err, "ยืนยันรับข้อความจากร้าน", "pos"));
  }
}

/** Owner: signal every online device to reload when safe (e.g. after deploy). */
export async function requestPosDevicesReload(
  deviceIds: string[],
  updatedBy: string,
): Promise<number> {
  const unique = [...new Set(deviceIds.filter(Boolean))];
  if (!unique.length) return 0;
  const now = Date.now();
  await Promise.all(
    unique.map((deviceId) =>
      setDoc(
        deviceRef(deviceId),
        {
          forceReloadAt: now,
          updatedAt: now,
          updatedBy,
        },
        { merge: true },
      ).catch((err) => {
        throw new Error(mapFirestoreError(err, "สั่งรีเฟรชเครื่อง POS", "pos"));
      }),
    ),
  );
  return unique.length;
}

export async function listPosDevices(): Promise<PosDevice[]> {
  const snap = await getDocs(query(devicesCol(), orderBy("lastSeenAt", "desc")));
  return snap.docs.map((d) => mapPosDeviceDoc(d.id, d.data() as Record<string, unknown>));
}

export function subscribePosDevices(
  onDevices: (devices: PosDevice[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(devicesCol(), orderBy("lastSeenAt", "desc"));
  return onSnapshot(
    q,
    (snap) => {
      const devices = snap.docs.map((d) => mapPosDeviceDoc(d.id, d.data() as Record<string, unknown>));
      onDevices(devices);
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

/** Owner back-office — read with main Auth (Google), not POS tablet auth. */
export function subscribePosDevicesAdmin(
  onDevices: (devices: PosDevice[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(collection(getDb(), POS_DEVICES_COL), orderBy("lastSeenAt", "desc"));
  return onSnapshot(
    q,
    (snap) => {
      const devices = snap.docs.map((d) => mapPosDeviceDoc(d.id, d.data() as Record<string, unknown>));
      onDevices(devices);
    },
    (err) =>
      onError?.(
        err instanceof Error ? err : new Error(mapFirestoreError(err, "อ่านรายการเครื่อง POS", "pos")),
      ),
  );
}

export function subscribePosDevice(
  deviceId: string,
  onDevice: (device: PosDevice | null) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    deviceRef(deviceId),
    (snap) => {
      onDevice(snap.exists() ? mapPosDeviceDoc(snap.id, snap.data() as Record<string, unknown>) : null);
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}
