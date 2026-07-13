import { signInAnonymously, signInWithCustomToken } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { getFirebaseAuth, getFirebaseFunctions } from "./firebase";
import { mapFirestoreError } from "./firestore-errors";

const POS_DEVICE_ID_KEY = "telltea-pos-device-id";

function getStoredDeviceId(): string | null {
  if (typeof localStorage === "undefined") return null;
  const id = localStorage.getItem(POS_DEVICE_ID_KEY);
  return id && id.length >= 8 ? id : null;
}

function storeDeviceId(id: string) {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(POS_DEVICE_ID_KEY, id);
  }
}

async function isCurrentPosUser(): Promise<boolean> {
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  if (!user?.uid) return false;
  try {
    const token = await user.getIdTokenResult();
    if (token.claims.posDevice === true) return true;
    if (token.signInProvider === "anonymous") return true;
  } catch {
    return false;
  }
  return false;
}

async function signInPosWithCustomToken(): Promise<string> {
  const posDeviceAuth = httpsCallable<
    { deviceId?: string },
    { token: string; deviceId: string }
  >(getFirebaseFunctions(), "posDeviceAuth");

  const storedId = getStoredDeviceId();
  const result = await posDeviceAuth(storedId ? { deviceId: storedId } : {});
  const { token, deviceId } = result.data;
  if (!token || !deviceId) {
    throw new Error("POS auth response ไม่สมบูรณ์");
  }

  storeDeviceId(deviceId);
  const cred = await signInWithCustomToken(getFirebaseAuth(), token);
  return cred.user.uid;
}

/** Dedicated POS tablets — auto sign-in, no staff password. */
export async function ensurePosDeviceAuth(): Promise<string> {
  const auth = getFirebaseAuth();

  if (await isCurrentPosUser()) {
    return auth.currentUser!.uid;
  }

  if (auth.currentUser) {
    await auth.signOut();
  }

  try {
    return await signInPosWithCustomToken();
  } catch (primaryErr) {
    try {
      const cred = await signInAnonymously(auth);
      return cred.user.uid;
    } catch (fallbackErr) {
      const msg = (primaryErr as Error).message || "";
      if (/internal|unavailable|not-found|failed-precondition/i.test(msg)) {
        throw new Error(
          mapFirestoreError(
            primaryErr,
            "เชื่อมต่อเครื่อง POS — รอ deploy Cloud Function สักครู่แล้วลองใหม่",
          ),
        );
      }
      throw new Error(mapFirestoreError(fallbackErr, "เข้าสู่ระบบเครื่อง POS"));
    }
  }
}
