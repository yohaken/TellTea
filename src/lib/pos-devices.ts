import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { CLIENT_BUILD } from "./app-update";
import { getDb } from "./firebase";
import { mapFirestoreError } from "./firestore-errors";

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
};

function deviceRef(id: string) {
  return doc(getDb(), POS_DEVICES_COL, id);
}

function devicesCol() {
  return collection(getDb(), POS_DEVICES_COL);
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
): { deviceOnline: boolean; pill: PosConnectivityPill; label: string } {
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
  };
}

export async function registerPosDevice(authUid: string): Promise<PosDevice> {
  const ref = deviceRef(authUid);
  const snap = await getDoc(ref);
  const now = Date.now();
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";

  if (snap.exists()) {
    const device = mapPosDeviceDoc(authUid, snap.data() as Record<string, unknown>);
    await heartbeatPosDevice(authUid);
    return { ...device, lastSeenAt: now, appBuild: CLIENT_BUILD, userAgent: ua };
  }

  const payload = {
    authUid,
    label: "",
    pairingCode: posPairingCodeFromId(authUid),
    registeredAt: now,
    lastSeenAt: now,
    appBuild: CLIENT_BUILD,
    userAgent: ua,
    forceReloadAt: 0,
    lastReloadAckAt: 0,
    disabled: false,
  };

  try {
    await setDoc(ref, payload, { merge: true });
  } catch (err) {
    throw new Error(mapFirestoreError(err, "ลงทะเบียนเครื่อง POS"));
  }

  return mapPosDeviceDoc(authUid, payload);
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
        appBuild: CLIENT_BUILD,
        userAgent: ua,
      },
      { merge: true },
    );
  } catch (err) {
    throw new Error(mapFirestoreError(err, "ส่งสัญญาณเครื่อง POS"));
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
    throw new Error(mapFirestoreError(err, "ยืนยันรีเฟรชเครื่อง POS"));
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
    throw new Error(mapFirestoreError(err, "บันทึกชื่อเครื่อง POS"));
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
    throw new Error(mapFirestoreError(err, "สั่งรีเฟรชเครื่อง POS"));
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
        throw new Error(mapFirestoreError(err, "สั่งรีเฟรชเครื่อง POS"));
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
