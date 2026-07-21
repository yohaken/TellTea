import { doc, onSnapshot, setDoc, type Firestore, type Unsubscribe } from "firebase/firestore";
import { getDb } from "./firebase";

export type AppReleaseSettings = {
  /** เจ้าของเปิด = reload อัตโนมัติเมื่อมี build ใหม่ (เหมาะช่วงพัฒนา) — ทั้งหลังบ้านและ POS */
  forceAppUpdate: boolean;
  /** POS เท่านั้น — อัปเดตเงียบเมื่อตะกร้าว่าง ไม่กระทบแท็บหลังบ้าน */
  forcePosAutoUpdate: boolean;
};

/** โหมดอัปเดตในหน้าตั้งค่า — map ลงสองฟลาก Firestore เดิม */
export type AppUpdateMode = "soft" | "force_all" | "force_pos";

const DEFAULT: AppReleaseSettings = { forceAppUpdate: false, forcePosAutoUpdate: false };

/**
 * ช่วงพัฒนา: บังคับโหมดอัปเดตทันที (ว่างตะกร้า/ไม่ได้กรอกฟอร์ม)
 * โปรดักชัน: ปิดไว้ — เจ้าของเปิดได้จากตั้งค่าเมื่อจะบังคับอัปเดต
 */
export const DEV_FORCE_IMMEDIATE_UPDATE = false;

function uiRef(db: Firestore) {
  return doc(db, "meta", "ui");
}

export function normalizeAppReleaseSettings(data?: Record<string, unknown> | null): AppReleaseSettings {
  return {
    forceAppUpdate: data?.forceAppUpdate === true,
    forcePosAutoUpdate: data?.forcePosAutoUpdate === true,
  };
}

/** force_all มีลำดับสูงกว่า — POS รับผ่าน forceAppUpdate อยู่แล้ว */
export function appUpdateModeFromSettings(settings: AppReleaseSettings): AppUpdateMode {
  if (settings.forceAppUpdate) return "force_all";
  if (settings.forcePosAutoUpdate) return "force_pos";
  return "soft";
}

export function settingsFromAppUpdateMode(mode: AppUpdateMode): AppReleaseSettings {
  if (mode === "force_all") return { forceAppUpdate: true, forcePosAutoUpdate: false };
  if (mode === "force_pos") return { forceAppUpdate: false, forcePosAutoUpdate: true };
  return { forceAppUpdate: false, forcePosAutoUpdate: false };
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

export async function saveAppUpdateMode(mode: AppUpdateMode, updatedBy: string): Promise<void> {
  const next = settingsFromAppUpdateMode(mode);
  await setDoc(
    uiRef(getDb()),
    {
      ...next,
      updatedAt: Date.now(),
      updatedBy,
    },
    { merge: true },
  );
}

/** @deprecated ใช้ saveAppUpdateMode — คงฟลากอีกตัวไว้ */
export async function saveForceAppUpdate(forceAppUpdate: boolean, updatedBy: string): Promise<void> {
  await setDoc(
    uiRef(getDb()),
    {
      forceAppUpdate,
      // เปิดบังคับทุกเครื่องแล้วไม่ต้องเปิด POS แยก
      ...(forceAppUpdate ? { forcePosAutoUpdate: false } : {}),
      updatedAt: Date.now(),
      updatedBy,
    },
    { merge: true },
  );
}

/** @deprecated ใช้ saveAppUpdateMode — คงฟลากอีกตัวไว้ */
export async function saveForcePosAutoUpdate(forcePosAutoUpdate: boolean, updatedBy: string): Promise<void> {
  await setDoc(
    uiRef(getDb()),
    {
      forcePosAutoUpdate,
      // เปิดเฉพาะ POS ต้องปิดบังคับทุกเครื่อง
      ...(forcePosAutoUpdate ? { forceAppUpdate: false } : {}),
      updatedAt: Date.now(),
      updatedBy,
    },
    { merge: true },
  );
}
