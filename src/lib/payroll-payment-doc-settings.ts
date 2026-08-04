/**
 * ตั้งค่าหัวเอกสารหลักฐานจ่าย — ชื่อผู้จ่าย ฯลฯ
 * เก็บที่ meta/payrollPaymentDoc
 */
import { doc, getDoc, onSnapshot, setDoc, type Unsubscribe } from "firebase/firestore";
import { getDb } from "./firebase";

export const PAYROLL_PAYMENT_DOC_SETTINGS_DOC = "payrollPaymentDoc";

export type PayrollPaymentDocSettings = {
  /** ชื่อผู้จ่ายบนเอกสาร */
  payerName: string;
  /** ตำแหน่ง/บทบาทผู้จ่าย เช่น เจ้าของกิจการ */
  payerTitle: string;
  updatedAt: number;
};

export const DEFAULT_PAYROLL_PAYMENT_DOC_SETTINGS: PayrollPaymentDocSettings = {
  payerName: "พีระพงษ์ โยหาเคน",
  payerTitle: "เจ้าของกิจการ",
  updatedAt: 0,
};

function settingsRef() {
  return doc(getDb(), "meta", PAYROLL_PAYMENT_DOC_SETTINGS_DOC);
}

export function normalizePayrollPaymentDocSettings(
  raw: Partial<PayrollPaymentDocSettings> | null | undefined,
): PayrollPaymentDocSettings {
  const payerName = String(raw?.payerName ?? "").trim();
  const payerTitle = String(raw?.payerTitle ?? "").trim();
  return {
    payerName: payerName || DEFAULT_PAYROLL_PAYMENT_DOC_SETTINGS.payerName,
    payerTitle: payerTitle || DEFAULT_PAYROLL_PAYMENT_DOC_SETTINGS.payerTitle,
    updatedAt: Number(raw?.updatedAt) || 0,
  };
}

export async function getPayrollPaymentDocSettings(): Promise<PayrollPaymentDocSettings> {
  const snap = await getDoc(settingsRef());
  return normalizePayrollPaymentDocSettings(
    snap.exists() ? (snap.data() as Partial<PayrollPaymentDocSettings>) : null,
  );
}

export function subscribePayrollPaymentDocSettings(
  onData: (settings: PayrollPaymentDocSettings) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    settingsRef(),
    (snap) => {
      onData(
        normalizePayrollPaymentDocSettings(
          snap.exists() ? (snap.data() as Partial<PayrollPaymentDocSettings>) : null,
        ),
      );
    },
    (err) => onError?.(err as Error),
  );
}

export async function savePayrollPaymentDocSettings(
  patch: Partial<Pick<PayrollPaymentDocSettings, "payerName" | "payerTitle">>,
): Promise<PayrollPaymentDocSettings> {
  const current = await getPayrollPaymentDocSettings();
  const next = normalizePayrollPaymentDocSettings({
    ...current,
    payerName:
      patch.payerName != null ? String(patch.payerName).trim() : current.payerName,
    payerTitle:
      patch.payerTitle != null ? String(patch.payerTitle).trim() : current.payerTitle,
    updatedAt: Date.now(),
  });
  await setDoc(settingsRef(), next, { merge: true });
  return next;
}
