import { doc, onSnapshot, setDoc, type Firestore, type Unsubscribe } from "firebase/firestore";
import { getDb } from "./firebase";

export type AppReleaseSettings = {
  /** เจ้าของเปิด = reload อัตโนมัติเมื่อมี build ใหม่ (เหมาะช่วงพัฒนา) — ทั้งหลังบ้านและ POS */
  forceAppUpdate: boolean;
  /** POS เท่านั้น — อัปเดตเงียบเมื่อตะกร้าว่าง ไม่กระทบแท็บหลังบ้าน */
  forcePosAutoUpdate: boolean;
};

const DEFAULT: AppReleaseSettings = { forceAppUpdate: false, forcePosAutoUpdate: false };

/**
 * ช่วงพัฒนา: บังคับโหมดอัปเดตทันที (ว่างตะกร้า/ไม่ได้กรอกฟอร์ม)
 * ตั้งเป็น false เมื่อโปรดักชันนิ่งแล้วค่อยให้เจ้าของสลับจากหน้าตั้งค่า
 */
export const DEV_FORCE_IMMEDIATE_UPDATE = true;

function uiRef(db: Firestore) {
  return doc(db, "meta", "ui");
}

export function normalizeAppReleaseSettings(data?: Record<string, unknown> | null): AppReleaseSettings {
  return {
    forceAppUpdate: data?.forceAppUpdate === true,
    forcePosAutoUpdate: data?.forcePosAutoUpdate === true,
  };
}

export function subscribeAppReleaseSettings(
  onSettings: (settings: AppReleaseSettings) => void,
  onError?: (err: Error) => void,
  db: Firestore = getDb(),
): Unsubscribe {
  return onSnapshot(
    uiRef(db),
    (snap) => {
      onSettings(snap.exists() ? normalizeAppReleaseSettings(snap.data()) : { ...DEFAULT });
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export async function saveForceAppUpdate(forceAppUpdate: boolean, updatedBy: string): Promise<void> {
  await setDoc(
    uiRef(getDb()),
    {
      forceAppUpdate,
      updatedAt: Date.now(),
      updatedBy,
    },
    { merge: true },
  );
}

export async function saveForcePosAutoUpdate(forcePosAutoUpdate: boolean, updatedBy: string): Promise<void> {
  await setDoc(
    uiRef(getDb()),
    {
      forcePosAutoUpdate,
      updatedAt: Date.now(),
      updatedBy,
    },
    { merge: true },
  );
}
