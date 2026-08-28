import { signInWithEmailAndPassword } from "firebase/auth";
import { getFirebaseAuth } from "./firebase";
import { mapFirebaseAuthError } from "./member-auth";
import { normalizeEmail } from "./utils";

/** รหัสผ่านเริ่มต้น = เบอร์มือถือไทย 10 หลัก (0xxxxxxxxx) */
export function passwordFromPhone(phone: string): string | null {
  const raw = (phone || "").trim();
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("66") && digits.length >= 11) {
    digits = `0${digits.slice(2)}`;
  } else if (!digits.startsWith("0") && digits.length === 9) {
    digits = `0${digits}`;
  }
  return /^0[689]\d{8}$/.test(digits) ? digits : null;
}

export async function signInWithStaffEmailPassword(
  email: string,
  password: string,
): Promise<void> {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    throw new Error("ใส่อีเมลที่ลงทะเบียนไว้");
  }
  const pass = password.trim();
  if (!pass) {
    throw new Error("ใส่รหัสผ่าน (เบอร์โทร 10 หลัก)");
  }
  try {
    const auth = getFirebaseAuth();
    const cred = await signInWithEmailAndPassword(auth, normalized, pass);
    try {
      await cred.user.getIdToken(true);
    } catch {
      /* claim refresh best-effort */
    }
  } catch (err) {
    const code = (err as { code?: string })?.code || "";
    if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
      throw new Error("อีเมลหรือรหัสผ่านไม่ถูกต้อง — รหัสผ่านช่วงแรกคือเบอร์โทร 10 หลัก");
    }
    if (code === "auth/user-not-found") {
      throw new Error("ไม่พบบัญชีนี้ — ใช้อีเมลที่เจ้าของลงทะเบียนไว้");
    }
    if (code === "auth/operation-not-allowed") {
      throw new Error("ระบบอีเมล/รหัสผ่านยังไม่เปิด — แจ้งเจ้าของร้าน");
    }
    throw new Error(mapFirebaseAuthError(err));
  }
}
