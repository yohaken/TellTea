import {
  doc,
  getDoc,
  onSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";

/** เกณฑ์แจ้งเตือนยอดต่ำ (อ่านอย่างเดียว — ไม่มีหน้าตั้งค่าแล้ว) */
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
  return {
    lowBalanceThreshold: Number(data.lowBalanceThreshold) || DEFAULT_ALERT_SETTINGS.lowBalanceThreshold,
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
