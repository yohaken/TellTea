/**
 * Member public auth (/claim, /me) — stable path owned by TellTea.
 *
 * Google: Firebase native redirect on telltea-shop (same origin).
 * Does NOT use P-Note telltea-auth.html / loginTickets hop.
 *
 * Staff BO login still uses the legacy firebaseapp bridge in auth.tsx.
 */
import {
  GoogleAuthProvider,
  getRedirectResult,
  signInWithPopup,
  signInWithRedirect,
  type User,
} from "firebase/auth";
import { getFirebaseAuth } from "./firebase";

const MEMBER_GOOGLE_PENDING_KEY = "telltea_member_google_pending";

export function mapFirebaseAuthError(error: unknown): string {
  const code = (error as { code?: string })?.code || "";
  const message = (error as Error)?.message || "";
  if (code === "auth/popup-closed-by-user" || code === "auth/redirect-cancelled-by-user") {
    return "การล็อกอินถูกยกเลิก";
  }
  if (code === "auth/popup-blocked") {
    return "เบราว์เซอร์บล็อกหน้าต่างล็อกอิน — ลองอีกครั้ง";
  }
  if (code === "auth/unauthorized-domain") {
    return "โดเมนนี้ยังไม่อนุญาตใน Firebase Auth";
  }
  if (
    code === "auth/argument-error" ||
    code === "auth/internal-error" ||
    code === "auth/network-request-failed"
  ) {
    return "เข้าสู่ระบบไม่สำเร็จ — เปิดใน Chrome/Safari แล้วลองใหม่ หรือใช้เบอร์มือถือไทย";
  }
  if (
    code === "auth/configuration-not-found" ||
    code === "auth/operation-not-allowed" ||
    /redirect_uri_mismatch/i.test(message)
  ) {
    return "ตั้งค่า Google Sign-In ยังไม่ครบ — แจ้งเจ้าของร้าน";
  }
  if (code === "auth/invalid-credential" || code === "auth/invalid-id-token") {
    return "โทเคนล็อกอินหมดอายุ — กดเข้าสู่ระบบอีกครั้ง";
  }
  if (code === "auth/invalid-phone-number" || code === "auth/missing-phone-number") {
    return "ใช้เบอร์มือถือไทย (06 / 08 / 09)";
  }
  if (code === "auth/invalid-verification-code") {
    return "รหัส OTP ไม่ถูกต้อง";
  }
  if (code === "auth/code-expired") {
    return "รหัส OTP หมดอายุ — ขอรหัสใหม่";
  }
  if (code === "auth/too-many-requests" || code === "auth/quota-exceeded") {
    return "ลองบ่อยเกินไป — รอสักครู่แล้วลองใหม่";
  }
  if (code === "auth/captcha-check-failed" || code === "auth/invalid-app-credential") {
    return "ยืนยันตัวตนไม่ผ่าน — รีเฟรชหน้าแล้วลองใหม่";
  }
  if (code === "auth/credential-already-in-use") {
    return "เบอร์นี้ผูกบัญชีอื่นแล้ว — เข้าด้วยเบอร์นั้นแทน";
  }
  if (/Firebase:\s*Error|auth\/[a-z0-9-]+/i.test(message)) {
    return "เข้าสู่ระบบไม่สำเร็จ — ลองใหม่ หรือใช้เบอร์มือถือไทย";
  }
  return message || "การล็อกอินล้มเหลว";
}

function isLocalhostHost(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
}

function memberGoogleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  provider.addScope("email");
  provider.addScope("profile");
  provider.setCustomParameters({ prompt: "select_account" });
  return provider;
}

/**
 * Start Google sign-in for members.
 * Production: same-origin redirect (no P-Note bridge).
 * Localhost: popup for convenience.
 * @returns user when popup path; null when redirecting away.
 */
export async function signInMemberWithGoogle(): Promise<User | null> {
  const auth = getFirebaseAuth();
  const provider = memberGoogleProvider();
  try {
    if (!isLocalhostHost()) {
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.setItem(
          MEMBER_GOOGLE_PENDING_KEY,
          window.location.href.replace(/#.*$/, ""),
        );
      }
      await signInWithRedirect(auth, provider);
      return null;
    }
    const cred = await signInWithPopup(auth, provider);
    return cred.user;
  } catch (err) {
    throw new Error(mapFirebaseAuthError(err));
  }
}

/**
 * Finish Google redirect on /claim or /me.
 * @returns true when a Google session was established from redirect.
 */
export async function completeMemberGoogleRedirect(): Promise<boolean> {
  const auth = getFirebaseAuth();
  try {
    await auth.authStateReady();
    const result = await getRedirectResult(auth);
    if (result?.user) {
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.removeItem(MEMBER_GOOGLE_PENDING_KEY);
      }
      return true;
    }
    // Some mobile browsers drop redirect result but keep the session.
    if (
      typeof sessionStorage !== "undefined" &&
      sessionStorage.getItem(MEMBER_GOOGLE_PENDING_KEY) &&
      auth.currentUser
    ) {
      sessionStorage.removeItem(MEMBER_GOOGLE_PENDING_KEY);
      return true;
    }
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem(MEMBER_GOOGLE_PENDING_KEY);
    }
    return false;
  } catch (err) {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem(MEMBER_GOOGLE_PENDING_KEY);
    }
    throw new Error(mapFirebaseAuthError(err));
  }
}
