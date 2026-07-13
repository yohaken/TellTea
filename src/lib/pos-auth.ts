import { onAuthStateChanged, signInAnonymously, signInWithCustomToken, type User } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { getPosFirebaseAuth, getPosFirebaseFunctions } from "./pos-firebase";
import { mapFirestoreError } from "./firestore-errors";

const POS_DEVICE_ID_KEY = "telltea-pos-device-id";
const AUTH_RESTORE_MS = 2_500;

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

async function userIsPosDevice(user: User): Promise<boolean> {
  try {
    const token = await user.getIdTokenResult();
    if (token.claims.posDevice === true) return true;
    return token.signInProvider === "anonymous";
  } catch {
    return false;
  }
}

function waitForRestoredAuthUser(timeoutMs = AUTH_RESTORE_MS): Promise<User | null> {
  const auth = getPosFirebaseAuth();
  if (auth.currentUser) return Promise.resolve(auth.currentUser);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (user: User | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsub();
      resolve(user);
    };

    const timer = window.setTimeout(() => finish(auth.currentUser), timeoutMs);
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) finish(user);
    });
  });
}

async function signInPosWithCustomToken(): Promise<string> {
  const posDeviceAuth = httpsCallable<
    { deviceId?: string },
    { token: string; deviceId: string }
  >(getPosFirebaseFunctions(), "posDeviceAuth");

  const storedId = getStoredDeviceId();
  const result = await posDeviceAuth(storedId ? { deviceId: storedId } : {});
  const { token, deviceId } = result.data;
  if (!token || !deviceId) {
    throw new Error("POS auth response ไม่สมบูรณ์");
  }

  storeDeviceId(deviceId);
  const cred = await signInWithCustomToken(getPosFirebaseAuth(), token);
  await cred.user.getIdToken(true);
  return cred.user.uid;
}

/** Kick IndexedDB auth restore as early as possible (POS layout). */
export function warmPosAuth(): void {
  void waitForRestoredAuthUser();
}

/** Dedicated POS tablets — auto sign-in, isolated from หลังร้าน Google login. */
export async function ensurePosDeviceAuth(): Promise<string> {
  const auth = getPosFirebaseAuth();

  const restored = await waitForRestoredAuthUser();
  if (restored && (await userIsPosDevice(restored))) {
    return restored.uid;
  }

  if (auth.currentUser && (await userIsPosDevice(auth.currentUser))) {
    return auth.currentUser.uid;
  }

  try {
    return await signInPosWithCustomToken();
  } catch (primaryErr) {
    try {
      const cred = await signInAnonymously(auth);
      await cred.user.getIdToken(true);
      return cred.user.uid;
    } catch (fallbackErr) {
      const msg = (primaryErr as Error).message || "";
      if (/internal|unavailable|not-found|failed-precondition/i.test(msg)) {
        throw new Error(
          mapFirestoreError(
            primaryErr,
            "เชื่อมต่อเครื่อง POS — รอ deploy สักครู่แล้วลองใหม่",
            "pos",
          ),
        );
      }
      throw new Error(mapFirestoreError(fallbackErr, "เข้าสู่ระบบเครื่อง POS", "pos"));
    }
  }
}
