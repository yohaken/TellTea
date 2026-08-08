import {
  RecaptchaVerifier,
  linkWithPhoneNumber,
  signInWithPhoneNumber,
  type ConfirmationResult,
} from "firebase/auth";
import { mapFirebaseAuthError } from "./member-auth";
import { getFirebaseAuth } from "./firebase";
import { normalizePhone } from "./utils";

let recaptchaVerifier: RecaptchaVerifier | null = null;

/** Thai mobile only — SMS OTP rejects landlines / junk autofill (e.g. 010…). */
export function normalizeThaiMobileForOtp(input: string): string {
  const e164 = normalizePhone(input);
  const local = e164.replace(/^\+66/, "");
  if (!/^[689]\d{8}$/.test(local)) {
    throw new Error("ใช้เบอร์มือถือไทย (06 / 08 / 09)");
  }
  return e164;
}

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

export async function ensurePhoneRecaptcha(
  containerId: string,
): Promise<RecaptchaVerifier> {
  resetPhoneRecaptcha();
  if (typeof document === "undefined") {
    throw new Error("รีเฟรชหน้าแล้วลองใหม่");
  }
  let el = document.getElementById(containerId);
  if (!el) {
    el = document.createElement("div");
    el.id = containerId;
    el.style.display = "none";
    document.body.appendChild(el);
  } else {
    el.innerHTML = "";
  }
  const verifier = new RecaptchaVerifier(getFirebaseAuth(), containerId, {
    size: "invisible",
    callback: () => undefined,
    "expired-callback": () => {
      resetPhoneRecaptcha();
    },
  });
  try {
    await verifier.render();
  } catch (err) {
    try {
      verifier.clear();
    } catch {
      // ignore
    }
    throw new Error(mapFirebaseAuthError(err));
  }
  recaptchaVerifier = verifier;
  return verifier;
}

/** Phone-only sign-in (primary path on /claim). */
export async function sendPhoneOtp(
  phoneInput: string,
  containerId: string,
): Promise<ConfirmationResult> {
  try {
    const phone = normalizeThaiMobileForOtp(phoneInput);
    const verifier = await ensurePhoneRecaptcha(containerId);
    return await signInWithPhoneNumber(getFirebaseAuth(), phone, verifier);
  } catch (err) {
    resetPhoneRecaptcha();
    if (err instanceof Error && !/Firebase:|auth\//i.test(err.message)) {
      throw err;
    }
    throw new Error(mapFirebaseAuthError(err));
  }
}

/**
 * Link phone to the current Google session via OTP (first-time signup).
 * Keeps Google uid/email on the same Auth user.
 */
export async function sendLinkPhoneOtp(
  phoneInput: string,
  containerId: string,
): Promise<ConfirmationResult> {
  try {
    const auth = getFirebaseAuth();
    const user = auth.currentUser;
    if (!user) throw new Error("เข้าสู่ระบบก่อน");
    const phone = normalizeThaiMobileForOtp(phoneInput);
    const verifier = await ensurePhoneRecaptcha(containerId);
    return await linkWithPhoneNumber(user, phone, verifier);
  } catch (err) {
    resetPhoneRecaptcha();
    if (err instanceof Error && !/Firebase:|auth\//i.test(err.message)) {
      throw err;
    }
    throw new Error(mapFirebaseAuthError(err));
  }
}

export async function confirmPhoneOtp(
  confirmation: ConfirmationResult,
  code: string,
) {
  try {
    const trimmed = code.replace(/\D/g, "");
    if (trimmed.length < 4) throw new Error("รหัส OTP ไม่ถูกต้อง");
    await confirmation.confirm(trimmed);
    resetPhoneRecaptcha();
  } catch (err) {
    if (err instanceof Error && !/Firebase:|auth\//i.test(err.message)) {
      throw err;
    }
    throw new Error(mapFirebaseAuthError(err));
  }
}

export function currentAuthHasVerifiedPhone(): boolean {
  const phone = getFirebaseAuth().currentUser?.phoneNumber || "";
  return phone.replace(/\D/g, "").length >= 9;
}
