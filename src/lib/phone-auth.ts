import {
  RecaptchaVerifier,
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

export async function sendPhoneOtp(
  phoneInput: string,
  containerId: string,
): Promise<ConfirmationResult> {
  const phone = normalizePhone(phoneInput);
  const verifier = ensurePhoneRecaptcha(containerId);
  return signInWithPhoneNumber(getFirebaseAuth(), phone, verifier);
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
