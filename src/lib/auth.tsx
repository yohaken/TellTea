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
  browserLocalPersistence,
  getRedirectResult,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { getFirebaseAuth, isFirebaseConfigured } from "./firebase";
import { ensureOwnerBootstrap, getStaffMember } from "./staff";
import type { StaffMember } from "./types";
import { normalizeEmail } from "./utils";

type AuthStatus = "loading" | "signedOut" | "denied" | "ready" | "unconfigured";

type AuthContextValue = {
  status: AuthStatus;
  user: User | null;
  staff: StaffMember | null;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshStaff: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const REDIRECT_FLAG = "telltea_auth_redirect";

function shouldPreferRedirectAuth() {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return false;
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod|Android/i.test(ua)) return true;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  return false;
}

function mapAuthError(error: unknown) {
  const code = (error as { code?: string })?.code || "";
  if (code === "auth/popup-closed-by-user" || code === "auth/redirect-cancelled-by-user") {
    return "การล็อกอินถูกยกเลิก";
  }
  if (code === "auth/popup-blocked") {
    return "เปิดหน้าต่างล็อกอินไม่ได้ — กำลังลองวิธีอื่น";
  }
  if (code === "auth/configuration-not-found" || code === "auth/operation-not-allowed") {
    return "ยังไม่ได้เปิด Google Sign-In ใน Firebase Console";
  }
  return (error as Error)?.message || "การล็อกอินล้มเหลว";
}

async function resolveStaff(user: User): Promise<StaffMember | null> {
  const email = normalizeEmail(user.email || "");
  if (!email) return null;
  const bootstrapped = await ensureOwnerBootstrap(email, user.displayName);
  if (bootstrapped) return bootstrapped;
  return getStaffMember(email);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [staff, setStaff] = useState<StaffMember | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshStaff = useCallback(async () => {
    if (!user?.email) return;
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
    let unsub = () => {};

    (async () => {
      try {
        await setPersistence(auth, browserLocalPersistence);
        if (sessionStorage.getItem(REDIRECT_FLAG) === "1") {
          sessionStorage.removeItem(REDIRECT_FLAG);
          await getRedirectResult(auth);
        }
      } catch (err) {
        setError(mapAuthError(err));
      }

      unsub = onAuthStateChanged(auth, async (next) => {
        setError(null);
        if (!next) {
          setUser(null);
          setStaff(null);
          setStatus("signedOut");
          return;
        }
        setUser(next);
        setStatus("loading");
        try {
          const member = await resolveStaff(next);
          setStaff(member);
          setStatus(member ? "ready" : "denied");
        } catch (err) {
          setError(mapAuthError(err));
          setStaff(null);
          setStatus("denied");
        }
      });
    })();

    return () => unsub();
  }, []);

  const signIn = useCallback(async () => {
    if (!isFirebaseConfigured()) {
      setError("Firebase ยังไม่ได้ตั้งค่า");
      return;
    }
    setError(null);
    const auth = getFirebaseAuth();
    const provider = new GoogleAuthProvider();
    provider.addScope("email");
    provider.setCustomParameters({ prompt: "select_account" });
    try {
      if (shouldPreferRedirectAuth()) {
        sessionStorage.setItem(REDIRECT_FLAG, "1");
        await signInWithRedirect(auth, provider);
        return;
      }
      await signInWithPopup(auth, provider);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "auth/popup-blocked") {
        sessionStorage.setItem(REDIRECT_FLAG, "1");
        await signInWithRedirect(auth, provider);
        return;
      }
      setError(mapAuthError(err));
    }
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(getFirebaseAuth());
  }, []);

  const value = useMemo(
    () => ({ status, user, staff, error, signIn, signOut, refreshStaff }),
    [status, user, staff, error, signIn, signOut, refreshStaff],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
