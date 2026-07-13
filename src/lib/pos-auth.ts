import { signInAnonymously } from "firebase/auth";
import { getFirebaseAuth } from "./firebase";

/** Anonymous Firebase Auth for dedicated POS tablets (kiosk). */
export async function ensurePosDeviceAuth(): Promise<string> {
  const auth = getFirebaseAuth();
  if (auth.currentUser?.uid) {
    return auth.currentUser.uid;
  }
  const cred = await signInAnonymously(auth);
  return cred.user.uid;
}
