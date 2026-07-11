import {
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";

export type AlertSettings = {
  /** แจ้งเมื่อยอดคงเหลือต่ำกว่านี้ (บาท) */
  lowBalanceThreshold: number;
  /** เปิดการแจ้งเตือนยอดต่ำ */
  lowBalanceEnabled: boolean;
  /** ขนาดตัวอักษรของยอดคงเหลือ (rem) */
  balanceFontSize: number;
  /** ขนาดของปุ่มจ่าย/โอนเข้า (scale) */
  actionBtnScale: number;
  updatedAt: number;
  updatedBy: string;
};

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  lowBalanceThreshold: 5000,
  lowBalanceEnabled: true,
  balanceFontSize: 1.15,
  actionBtnScale: 1,
  updatedAt: 0,
  updatedBy: "",
};

function settingsRef() {
  return doc(getDb(), "meta", "settings");
}

export async function getAlertSettings(): Promise<AlertSettings> {
  const snap = await getDoc(settingsRef());
  if (!snap.exists()) return { ...DEFAULT_ALERT_SETTINGS };
  const data = snap.data() as Partial<AlertSettings>;
  return {
    lowBalanceThreshold: Number(data.lowBalanceThreshold) || DEFAULT_ALERT_SETTINGS.lowBalanceThreshold,
    lowBalanceEnabled: data.lowBalanceEnabled !== false,
    balanceFontSize: clampBalanceFontSize(Number(data.balanceFontSize)),
    actionBtnScale: clampActionBtnScale(data.actionBtnScale),
    updatedAt: Number(data.updatedAt) || 0,
    updatedBy: String(data.updatedBy || ""),
  };
}

export async function saveAlertSettings(
  patch: Pick<AlertSettings, "lowBalanceThreshold" | "lowBalanceEnabled" | "balanceFontSize" | "actionBtnScale">,
  updatedBy: string,
): Promise<void> {
  const threshold = Math.max(0, Number(patch.lowBalanceThreshold) || 0);
  const fontSize = clampBalanceFontSize(patch.balanceFontSize);
  const btnScale = clampActionBtnScale(patch.actionBtnScale);
  await setDoc(
    settingsRef(),
    {
      lowBalanceThreshold: threshold,
      lowBalanceEnabled: Boolean(patch.lowBalanceEnabled),
      balanceFontSize: fontSize,
      actionBtnScale: btnScale,
      updatedAt: Date.now(),
      updatedBy,
    },
    { merge: true },
  );
}

export function clampBalanceFontSize(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(3, Math.max(0.7, Math.round(n * 100) / 100)) : DEFAULT_ALERT_SETTINGS.balanceFontSize;
}

export function clampActionBtnScale(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(1.8, Math.max(0.8, Math.round(n * 100) / 100)) : DEFAULT_ALERT_SETTINGS.actionBtnScale;
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
      const data = snap.data() as Partial<AlertSettings>;
      onSettings({
        lowBalanceThreshold:
          Number(data.lowBalanceThreshold) || DEFAULT_ALERT_SETTINGS.lowBalanceThreshold,
        lowBalanceEnabled: data.lowBalanceEnabled !== false,
        balanceFontSize: clampBalanceFontSize(data.balanceFontSize),
        actionBtnScale: clampActionBtnScale(data.actionBtnScale),
        updatedAt: Number(data.updatedAt) || 0,
        updatedBy: String(data.updatedBy || ""),
      });
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export function isLowBalance(balance: number, settings: AlertSettings) {
  return settings.lowBalanceEnabled && balance < settings.lowBalanceThreshold;
}
