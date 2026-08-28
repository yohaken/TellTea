import { signInWithCustomToken } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { getFirebaseAuth, getFirebaseFunctions } from "./firebase";
import { mapFirebaseAuthError } from "./member-auth";
import { withTimeout } from "./pos-timeout";

export const STAFF_PIN_LOGIN_TIMEOUT_MS = 12_000;

/** 6 หลักท้ายเบอร์มือถือไทย (local 0xxxxxxxx) — ใช้ตั้ง PIN เริ่มต้น */
export function defaultPinFromPhone(phone: string): string | null {
  const raw = (phone || "").trim();
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("66") && digits.length >= 11) {
    digits = `0${digits.slice(2)}`;
  } else if (!digits.startsWith("0") && digits.length === 9) {
    digits = `0${digits}`;
  }
  const pin = digits.slice(-6);
  return /^\d{4,6}$/.test(pin) ? pin : null;
}

export async function callStaffPinLogin(nickname: string, pin: string): Promise<string> {
  const fn = httpsCallable<
    { nickname: string; pin: string },
    { ok?: boolean; token?: string; staffId?: string }
  >(getFirebaseFunctions(), "staffPinLogin");
  const res = await withTimeout(
    fn({ nickname: nickname.trim(), pin: pin.trim() }),
    STAFF_PIN_LOGIN_TIMEOUT_MS,
    "เข้าด้วย PIN หมดเวลา — ลองใหม่",
  );
  const token = String(res.data?.token || "").trim();
  if (!token) {
    throw new Error("เข้าด้วย PIN ไม่สำเร็จ — ตรวจชื่อและ PIN");
  }
  return token;
}

export async function signInWithStaffPin(nickname: string, pin: string): Promise<void> {
  try {
    const token = await callStaffPinLogin(nickname, pin);
    const auth = getFirebaseAuth();
    const cred = await signInWithCustomToken(auth, token);
    try {
      await cred.user.getIdToken(true);
    } catch {
      /* claim applies on next read */
    }
  } catch (err) {
    throw new Error(mapFirebaseAuthError(err));
  }
}

export async function setStaffLoginPinFromOwner(input: {
  staffId: string;
  pin: string;
  clear?: boolean;
}): Promise<void> {
  const fn = httpsCallable<
    { staffId: string; pin?: string; clear?: boolean },
    { ok?: boolean }
  >(getFirebaseFunctions(), "setStaffLoginPin");
  await fn({
    staffId: input.staffId,
    pin: input.clear ? "" : input.pin,
    clear: input.clear,
  });
}
