import { doc, onSnapshot, setDoc, type Unsubscribe } from "firebase/firestore";
import { getPosDb } from "./pos-firebase";
import { mapFirestoreError } from "./firestore-errors";
import { getDb } from "./firebase";

export const POS_NATIVE_RELEASE_DOC = "posNativeRelease";

export type PosNativeRelease = {
  /** เลข APK ล่าสุดที่เจ้าของปล่อย */
  latestShellBuild: number;
  /** URL ไฟล์ .apk (Drive / Storage / CDN) */
  apkUrl: string;
  notes: string;
  updatedAt: number;
  updatedBy: string;
};

const EMPTY: PosNativeRelease = {
  latestShellBuild: 0,
  apkUrl: "",
  notes: "",
  updatedAt: 0,
  updatedBy: "",
};

export function normalizePosNativeRelease(
  data?: Record<string, unknown> | null,
): PosNativeRelease {
  return {
    latestShellBuild:
      typeof data?.latestShellBuild === "number" ? data.latestShellBuild : 0,
    apkUrl: typeof data?.apkUrl === "string" ? data.apkUrl : "",
    notes: typeof data?.notes === "string" ? data.notes : "",
    updatedAt: typeof data?.updatedAt === "number" ? data.updatedAt : 0,
    updatedBy: typeof data?.updatedBy === "string" ? data.updatedBy : "",
  };
}

function releaseRef(db = getPosDb()) {
  return doc(db, "meta", POS_NATIVE_RELEASE_DOC);
}

/** POS tablet (pos Firebase) อ่านปล่อยอัปเดต */
export function subscribePosNativeRelease(
  onRelease: (release: PosNativeRelease) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    releaseRef(getPosDb()),
    (snap) => {
      onRelease(snap.exists() ? normalizePosNativeRelease(snap.data()) : { ...EMPTY });
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

/** หลังบ้าน (แอปหลัก) อ่าน/เขียนด้วย owner */
export function subscribePosNativeReleaseAdmin(
  onRelease: (release: PosNativeRelease) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    releaseRef(getDb()),
    (snap) => {
      onRelease(snap.exists() ? normalizePosNativeRelease(snap.data()) : { ...EMPTY });
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export async function savePosNativeRelease(
  input: {
    latestShellBuild: number;
    apkUrl: string;
    notes?: string;
  },
  updatedBy: string,
): Promise<void> {
  try {
    await setDoc(
      releaseRef(getDb()),
      {
        latestShellBuild: Math.max(0, Math.floor(input.latestShellBuild)),
        apkUrl: input.apkUrl.trim(),
        notes: (input.notes || "").trim(),
        updatedAt: Date.now(),
        updatedBy,
      },
      { merge: true },
    );
  } catch (err) {
    throw new Error(mapFirestoreError(err, "บันทึกปล่อยอัปเดต APK", "pos"));
  }
}
