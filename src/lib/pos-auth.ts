import { signInAnonymously } from "firebase/auth";
import { getFirebaseAuth } from "./firebase";
import { mapFirestoreError } from "./firestore-errors";

/** Anonymous Firebase Auth for dedicated POS tablets (kiosk). */
export async function ensurePosDeviceAuth(): Promise<string> {
  const auth = getFirebaseAuth();
  if (auth.currentUser?.uid) {
    return auth.currentUser.uid;
  }
  try {
    const cred = await signInAnonymously(auth);
    return cred.user.uid;
  } catch (err) {
    const code = (err as { code?: string })?.code || "";
    if (code === "auth/operation-not-allowed") {
      throw new Error(
        "ยังไม่เปิด Anonymous Auth ใน Firebase — เจ้าของเปิดที่ Authentication → Sign-in method → Anonymous",
      );
    }
    throw new Error(mapFirestoreError(err, "เข้าสู่ระบบเครื่อง POS"));
  }
}
