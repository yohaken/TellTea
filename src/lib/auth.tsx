"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signOut as firebaseSignOut,
  type ConfirmationResult,
  type User,
} from "firebase/auth";
import { deleteDoc, doc, getDoc } from "firebase/firestore";
import { clearAppCaches, loadCachedStaff, saveCachedStaff } from "./cache";
import { getDb, getFirebaseAuth, isFirebaseConfigured } from "./firebase";
import { confirmPhoneOtp, resetPhoneRecaptcha, sendPhoneOtp } from "./phone-auth";
import {
  ensureOwnerBootstrap,
  getStaffByPhone,
  getStaffMemberById,
  attachStaffPersonal,
} from "./staff";
import type { StaffMember } from "./types";
import { normalizeEmail, staffAccountLabel } from "./utils";

type AuthStatus = "loading" | "signedOut" | "denied" | "ready" | "unconfigured";

type AuthContextValue = {
  status: AuthStatus;
  user: User | null;
  staff: StaffMember | null;
  actorId: string;
  error: string | null;
  signIn: () => Promise<void>;
  sendPhoneLoginOtp: (phone: string, recaptchaContainerId: string) => Promise<void>;
  confirmPhoneLoginOtp: (code: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshStaff: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Long-term mobile-safe Google login:
 * OAuth completes on mypeer-501909.firebaseapp.com, stores a short-lived ticket,
 * then TellTea exchanges it with signInWithCredential.
 */
export const TELLTEA_AUTH_BRIDGE =
  "https://mypeer-501909.firebaseapp.com/telltea-auth.html";

function mapAuthError(error: unknown) {
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
    code === "auth/configuration-not-found" ||
    code === "auth/operation-not-allowed" ||
    /redirect_uri_mismatch/i.test(message)
  ) {
    return "ตั้งค่า Google Sign-In ยังไม่ครบ — แจ้งเจ้าของร้าน";
  }
  if (code === "auth/invalid-credential" || code === "auth/invalid-id-token") {
    return "โทเคนล็อกอินหมดอายุ — กดเข้าสู่ระบบอีกครั้ง";
  }
  if (code === "auth/invalid-verification-code") {
    return "รหัส OTP ไม่ถูกต้อง";
  }
  if (code === "auth/code-expired") {
    return "รหัส OTP หมดอายุ — ขอรหัสใหม่";
  }
  if (code === "auth/too-many-requests") {
    return "ลองบ่อยเกินไป — รอสักครู่แล้วลองใหม่";
  }
  if (code === "auth/captcha-check-failed") {
    return "ยืนยันตัวตนไม่ผ่าน — รีเฟรชหน้าแล้วลองใหม่";
  }
  if (code === "permission-denied") {
    return "อ่านสิทธิ์พนักงานไม่ได้ — ลองออกแล้วเข้าใหม่";
  }
  return message || "การล็อกอินล้มเหลว";
}

function emailFromUser(user: User) {
  const raw = user.email || user.providerData?.find((p) => p.email)?.email || "";
  return raw ? normalizeEmail(raw) : "";
}

function cacheKeyFromUser(user: User): string | null {
  const email = emailFromUser(user);
  if (email) return email;
  if (user.phoneNumber) return user.phoneNumber;
  return null;
}

export function actorIdFromUser(user: User | null, staff: StaffMember | null): string {
  if (user?.email) return normalizeEmail(user.email);
  if (user?.phoneNumber) return user.phoneNumber;
  if (staff) return staffAccountLabel(staff);
  return "";
}

async function resolveStaff(user: User): Promise<StaffMember | null> {
  const email = emailFromUser(user);
  let member: StaffMember | null = null;
  if (email) {
    const bootstrapped = await ensureOwnerBootstrap(email, user.displayName);
    member = bootstrapped || (await getStaffMemberById(email));
  } else if (user.phoneNumber) {
    member = await getStaffByPhone(user.phoneNumber);
  }
  if (!member) return null;
  // ข้อมูลส่วนตัว (staffPersonal) ต้องไม่บล็อกการเข้าใช้ — อ่านไม่ได้ก็เข้าได้ก่อน
  if (member.role === "staff") {
    try {
      return await attachStaffPersonal(member);
    } catch {
      return member;
    }
  }
  return member;
}

function takeTicketFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const ticket = url.searchParams.get("ticket");
  if (!ticket) return null;
  url.searchParams.delete("ticket");
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  return ticket;
}

async function idTokenFromTicket(ticket: string): Promise<string> {
  const ref = doc(getDb(), "loginTickets", ticket);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new Error("ลิงก์ล็อกอินหมดอายุ — กดเข้าสู่ระบบอีกครั้ง");
  }
  const data = snap.data() as { idToken?: string; exp?: number };
  void deleteDoc(ref).catch(() => undefined);
  if (!data.idToken) {
    throw new Error("ลิงก์ล็อกอินไม่ถูกต้อง");
  }
  if (data.exp && data.exp < Date.now()) {
    throw new Error("ลิงก์ล็อกอินหมดอายุ — กดเข้าสู่ระบบอีกครั้ง");
  }
  return data.idToken;
}

function shouldUseAuthBridge() {
  if (typeof window === "undefined") return true;
  const host = window.location.hostname;
  return !(host === "localhost" || host === "127.0.0.1");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(() =>
    isFirebaseConfigured() ? "loading" : "unconfigured",
  );
  const [user, setUser] = useState<User | null>(null);
  const [staff, setStaff] = useState<StaffMember | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phoneConfirmation, setPhoneConfirmation] = useState<ConfirmationResult | null>(null);

  const refreshStaff = useCallback(async () => {
    if (!user) return;
    const member = await resolveStaff(user);
    setStaff(member);
    setStatus(member ? "ready" : "denied");
  }, [user]);

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setStatus("unconfigured");
      return;
    }

    const auth = getFirebaseAuth();
    let cancelled = false;
    let bridgePending = false;

    void (async () => {
      const ticket = takeTicketFromUrl();
      if (!ticket) return;
      bridgePending = true;
      setStatus("loading");
      setError(null);
      try {
        const idToken = await idTokenFromTicket(ticket);
        await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
      } catch (err) {
        if (!cancelled) setError(mapAuthError(err));
      } finally {
        bridgePending = false;
        if (!cancelled && !auth.currentUser) {
          setStatus("signedOut");
        }
      }
    })();

    const readyTimeout = window.setTimeout(() => {
      if (!cancelled && !bridgePending && !auth.currentUser) {
        setStatus((prev) => (prev === "loading" ? "signedOut" : prev));
      }
    }, 6000);

    void auth.authStateReady().then(() => {
      if (cancelled || bridgePending) return;
      if (!auth.currentUser) {
        setStatus((prev) => (prev === "loading" ? "signedOut" : prev));
      }
    });

    const unsub = onAuthStateChanged(auth, async (next) => {
      if (cancelled) return;
      if (!next) {
        if (bridgePending) return;
        clearAppCaches();
        resetPhoneRecaptcha();
        setPhoneConfirmation(null);
        setUser(null);
        setStaff(null);
        setStatus("signedOut");
        return;
      }
      setError(null);
      setUser(next);

      const cacheKey = cacheKeyFromUser(next);
      const cached = cacheKey ? loadCachedStaff(cacheKey) : null;
      if (cached) {
        setStaff(cached);
        setStatus("ready");
      } else {
        setStatus("loading");
      }

      try {
        const member = await resolveStaff(next);
        if (cancelled) return;
        setStaff(member);
        if (member) {
          saveCachedStaff(member);
          setStatus("ready");
        } else {
          clearAppCaches();
          setStatus("denied");
        }
      } catch (err) {
        if (cancelled) return;
        const code = (err as { code?: string })?.code || "";
        const message = (err as Error)?.message || "";
        const permissionDenied =
          code === "permission-denied" || /insufficient permissions/i.test(message);
        // อย่าเด้งออกถ้าแคชยังตรงบัญชีนี้ — โชว์ข้อผิดพลาดแล้วให้ใช้งานต่อได้
        if (permissionDenied && cached?.id) {
          setError(mapAuthError(err));
          setStaff(cached);
          setStatus("ready");
          return;
        }
        if (permissionDenied) {
          clearAppCaches();
          setError(mapAuthError(err));
          setStaff(null);
          setStatus("denied");
          return;
        }
        if (cached?.id) {
          setError(null);
          setStatus("ready");
          return;
        }
        setError(mapAuthError(err));
        setStaff(null);
        setStatus("denied");
      }
    });

    return () => {
      cancelled = true;
      window.clearTimeout(readyTimeout);
      unsub();
    };
  }, []);

  const signIn = useCallback(async () => {
    if (!isFirebaseConfigured()) {
      setError("Firebase ยังไม่ได้ตั้งค่า");
      return;
    }
    setError(null);

    if (shouldUseAuthBridge()) {
      const returnTo = `${window.location.origin}/login/`;
      window.location.assign(
        `${TELLTEA_AUTH_BRIDGE}?return=${encodeURIComponent(returnTo)}`,
      );
      return;
    }

    const auth = getFirebaseAuth();
    const provider = new GoogleAuthProvider();
    provider.addScope("email");
    provider.addScope("profile");
    provider.setCustomParameters({ prompt: "select_account" });
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      setError(mapAuthError(err));
    }
  }, []);

  const sendPhoneLoginOtp = useCallback(
    async (phone: string, recaptchaContainerId: string) => {
      if (!isFirebaseConfigured()) {
        setError("Firebase ยังไม่ได้ตั้งค่า");
        return;
      }
      setError(null);
      try {
        const confirmation = await sendPhoneOtp(phone, recaptchaContainerId);
        setPhoneConfirmation(confirmation);
      } catch (err) {
        resetPhoneRecaptcha();
        setError(mapAuthError(err));
        throw err;
      }
    },
    [],
  );

  const confirmPhoneLoginOtp = useCallback(
    async (code: string) => {
      if (!phoneConfirmation) {
        setError("ขอรหัส OTP ก่อน");
        return;
      }
      setError(null);
      try {
        await confirmPhoneOtp(phoneConfirmation, code);
        setPhoneConfirmation(null);
      } catch (err) {
        setError(mapAuthError(err));
        throw err;
      }
    },
    [phoneConfirmation],
  );

  const signOut = useCallback(async () => {
    clearAppCaches();
    resetPhoneRecaptcha();
    setPhoneConfirmation(null);
    await firebaseSignOut(getFirebaseAuth());
  }, []);

  const actorId = actorIdFromUser(user, staff);

  const value = useMemo(
    () => ({
      status,
      user,
      staff,
      actorId,
      error,
      signIn,
      sendPhoneLoginOtp,
      confirmPhoneLoginOtp,
      signOut,
      refreshStaff,
    }),
    [
      status,
      user,
      staff,
      actorId,
      error,
      signIn,
      sendPhoneLoginOtp,
      confirmPhoneLoginOtp,
      signOut,
      refreshStaff,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
