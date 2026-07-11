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
  getRedirectResult,
  onAuthStateChanged,
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

function mapAuthError(error: unknown) {
  const code = (error as { code?: string })?.code || "";
  const message = (error as Error)?.message || "";
  if (code === "auth/popup-closed-by-user" || code === "auth/redirect-cancelled-by-user") {
    return "การล็อกอินถูกยกเลิก";
  }
  if (code === "auth/popup-blocked") {
    return "เบราว์เซอร์บล็อกหน้าต่างล็อกอิน — ลองอีกครั้ง หรือเปิดใน Chrome/Safari";
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
  if (code === "permission-denied") {
    return "อ่านสิทธิ์พนักงานไม่ได้ — ลองออกแล้วเข้าใหม่";
  }
  return message || "การล็อกอินล้มเหลว";
}

function emailFromUser(user: User) {
  return normalizeEmail(user.email || user.providerData?.[0]?.email || "");
}

async function resolveStaff(user: User): Promise<StaffMember | null> {
  const email = emailFromUser(user);
  if (!email) return null;
  const bootstrapped = await ensureOwnerBootstrap(email, user.displayName);
  if (bootstrapped) return bootstrapped;
  return getStaffMember(email);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(() =>
    isFirebaseConfigured() ? "loading" : "unconfigured",
  );
  const [user, setUser] = useState<User | null>(null);
  const [staff, setStaff] = useState<StaffMember | null>(null);
  const [error, setError] = useState<string | null>(null);

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

    void (async () => {
      try {
        const pending = sessionStorage.getItem(REDIRECT_FLAG) === "1";
        const result = await getRedirectResult(auth);
        sessionStorage.removeItem(REDIRECT_FLAG);
        if (pending && !result && !auth.currentUser && !cancelled) {
          setError("ล็อกอินมือถือไม่สำเร็จ — เปิดใน Chrome หรือ Safari แล้วลองใหม่");
        }
      } catch (err) {
        sessionStorage.removeItem(REDIRECT_FLAG);
        if (!cancelled) setError(mapAuthError(err));
      }
    })();

    const unsub = onAuthStateChanged(auth, async (next) => {
      if (cancelled) return;
      if (!next) {
        setUser(null);
        setStaff(null);
        setStatus("signedOut");
        return;
      }
      setError(null);
      setUser(next);
      setStatus("loading");
      try {
        const member = await resolveStaff(next);
        if (cancelled) return;
        setStaff(member);
        setStatus(member ? "ready" : "denied");
      } catch (err) {
        if (cancelled) return;
        setError(mapAuthError(err));
        setStaff(null);
        setStatus("denied");
      }
    });

    return () => {
      cancelled = true;
      unsub();
    };
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
    provider.addScope("profile");
    provider.setCustomParameters({ prompt: "select_account" });

    // Prefer popup on every device (including phones). Redirect is a fallback only —
    // it breaks more often on mobile (in-app browsers / storage partitioning).
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "auth/popup-closed-by-user") {
        setError(mapAuthError(err));
        return;
      }
      if (
        code === "auth/popup-blocked" ||
        code === "auth/operation-not-supported-in-this-environment" ||
        code === "auth/cancelled-popup-request"
      ) {
        try {
          sessionStorage.setItem(REDIRECT_FLAG, "1");
          await signInWithRedirect(auth, provider);
          return;
        } catch (redirectErr) {
          setError(mapAuthError(redirectErr));
          return;
        }
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
