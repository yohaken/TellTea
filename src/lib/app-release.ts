import { doc, onSnapshot, setDoc, type Unsubscribe } from "firebase/firestore";
import { getDb } from "./firebase";

export type AppReleaseSettings = {
  /** เจ้าของเปิด = reload อัตโนมัติเมื่อมี build ใหม่ (เหมาะช่วงพัฒนา) */
  forceAppUpdate: boolean;
};

const DEFAULT: AppReleaseSettings = { forceAppUpdate: false };

function uiRef() {
  return doc(getDb(), "meta", "ui");
}

export function normalizeAppReleaseSettings(data?: Record<string, unknown> | null): AppReleaseSettings {
  return {
    forceAppUpdate: data?.forceAppUpdate === true,
  };
}

export function subscribeAppReleaseSettings(
  onSettings: (settings: AppReleaseSettings) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    uiRef(),
    (snap) => {
      onSettings(snap.exists() ? normalizeAppReleaseSettings(snap.data()) : { ...DEFAULT });
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export async function saveForceAppUpdate(forceAppUpdate: boolean, updatedBy: string): Promise<void> {
  await setDoc(
    uiRef(),
    {
      forceAppUpdate,
      updatedAt: Date.now(),
      updatedBy,
    },
    { merge: true },
  );
}
