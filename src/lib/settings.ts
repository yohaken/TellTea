import {
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";

/** เกณฑ์แจ้งเตือนยอดต่ำ (meta/settings) — ตั้งค่าที่ /settings/ หมวดแจ้งเตือนเจ้าของ */
export type AlertSettings = {
  lowBalanceThreshold: number;
  lowBalanceEnabled: boolean;
  updatedAt: number;
  updatedBy: string;
};

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  lowBalanceThreshold: 5000,
  lowBalanceEnabled: true,
  updatedAt: 0,
  updatedBy: "",
};

function settingsRef() {
  return doc(getDb(), "meta", "settings");
}

function parseAlertSettings(data: Partial<AlertSettings> | undefined): AlertSettings {
  if (!data) return { ...DEFAULT_ALERT_SETTINGS };
  const threshold = Number(data.lowBalanceThreshold);
  return {
    lowBalanceThreshold: Number.isFinite(threshold) && threshold >= 0
      ? threshold
      : DEFAULT_ALERT_SETTINGS.lowBalanceThreshold,
    lowBalanceEnabled: data.lowBalanceEnabled !== false,
    updatedAt: Number(data.updatedAt) || 0,
    updatedBy: String(data.updatedBy || ""),
  };
}

export async function getAlertSettings(): Promise<AlertSettings> {
  const snap = await getDoc(settingsRef());
  if (!snap.exists()) return { ...DEFAULT_ALERT_SETTINGS };
  return parseAlertSettings(snap.data() as Partial<AlertSettings>);
}

export async function saveAlertSettings(
  input: { lowBalanceThreshold: number; lowBalanceEnabled: boolean },
  actorId: string,
): Promise<void> {
  const threshold = Number(input.lowBalanceThreshold);
  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new Error("ยอดขั้นต่ำไม่ถูกต้อง");
  }
  await setDoc(
    settingsRef(),
    {
      lowBalanceThreshold: Math.round(threshold),
      lowBalanceEnabled: Boolean(input.lowBalanceEnabled),
      updatedAt: Date.now(),
      updatedBy: actorId || "owner",
    },
    { merge: true },
  );
}

export function subscribeAlertSettings(
  onSettings: (settings: AlertSettings) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    settingsRef(),
    (snap) => {
      if (!snap.exists()) {
        onSettings({ ...DEFAULT_ALERT_SETTINGS });
        return;
      }
      onSettings(parseAlertSettings(snap.data() as Partial<AlertSettings>));
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export function isLowBalance(balance: number, settings: AlertSettings) {
  return settings.lowBalanceEnabled && balance < settings.lowBalanceThreshold;
}
