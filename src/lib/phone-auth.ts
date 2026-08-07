import {
  RecaptchaVerifier,
  linkWithPhoneNumber,
  signInWithPhoneNumber,
  type ConfirmationResult,
} from "firebase/auth";
import { getFirebaseAuth } from "./firebase";
import { normalizePhone } from "./utils";

let recaptchaVerifier: RecaptchaVerifier | null = null;

export function resetPhoneRecaptcha() {
  if (recaptchaVerifier) {
    try {
      recaptchaVerifier.clear();
    } catch {
      // ignore
    }
    recaptchaVerifier = null;
  }
}

export function ensurePhoneRecaptcha(containerId: string): RecaptchaVerifier {
  resetPhoneRecaptcha();
  recaptchaVerifier = new RecaptchaVerifier(getFirebaseAuth(), containerId, {
    size: "invisible",
    callback: () => undefined,
  });
  return recaptchaVerifier;
}

/** Phone-only sign-in (secondary path on /claim). */
export async function sendPhoneOtp(
  phoneInput: string,
  containerId: string,
): Promise<ConfirmationResult> {
  const phone = normalizePhone(phoneInput);
  const verifier = ensurePhoneRecaptcha(containerId);
  return signInWithPhoneNumber(getFirebaseAuth(), phone, verifier);
}

/**
 * Link phone to the current Google session via OTP (first-time signup).
 * Keeps Google uid/email on the same Auth user.
 */
export async function sendLinkPhoneOtp(
  phoneInput: string,
  containerId: string,
): Promise<ConfirmationResult> {
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("เข้าสู่ระบบก่อน");
  const phone = normalizePhone(phoneInput);
  const verifier = ensurePhoneRecaptcha(containerId);
  return linkWithPhoneNumber(user, phone, verifier);
}

export async function confirmPhoneOtp(
  confirmation: ConfirmationResult,
  code: string,
) {
  const trimmed = code.replace(/\D/g, "");
  if (trimmed.length < 4) throw new Error("รหัส OTP ไม่ถูกต้อง");
  await confirmation.confirm(trimmed);
  resetPhoneRecaptcha();
}

export function currentAuthHasVerifiedPhone(): boolean {
  const phone = getFirebaseAuth().currentUser?.phoneNumber || "";
  return phone.replace(/\D/g, "").length >= 9;
}
