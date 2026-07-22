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
import { POS_BUILD } from "./pos-version";
import { collectPosDeviceTelemetry, type PosDeviceTelemetry } from "./pos-device-telemetry";
import { getPosDb } from "./pos-firebase";
import { getDb } from "./firebase";
import { mapFirestoreError } from "./firestore-errors";
import type { PosNativeUpdateStatus, PosShellKind } from "./pos-native-version";

export const POS_DEVICES_COL = "posDevices";
export const POS_HEARTBEAT_MS = 60 * 1000;
export const POS_ONLINE_MS = 3 * 60 * 1000;

export type PosDevice = {
  id: string;
  authUid: string;
  label: string;
  pairingCode: string;
  registeredAt: number;
  lastSeenAt: number;
  appBuild: number;
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
  printerReady: boolean;
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
    printerReady: data.printerReady === true,
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
  };
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
 */
export async function setNposDeviceBlocked(
  deviceId: string,
  blocked: boolean,
  updatedBy: string,
  opts?: { isEmulator?: boolean },
): Promise<void> {
  const restoreClass = opts?.isEmulator === true ? "dev" : "shop";
  try {
    await setDoc(
      deviceRef(deviceId),
      blocked
        ? {
            blocked: true,
            disabled: true,
            deviceClass: "blocked",
            updatedAt: Date.now(),
            updatedBy,
          }
        : {
            blocked: false,
            disabled: false,
            deviceClass: restoreClass,
            updatedAt: Date.now(),
            updatedBy,
          },
      { merge: true },
    );
  } catch (err) {
    throw new Error(mapFirestoreError(err, blocked ? "บล็อกเครื่อง nPos" : "ปลดบล็อกเครื่อง nPos", "pos"));
  }
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
