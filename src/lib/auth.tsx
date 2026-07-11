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

/**
 * Long-term mobile-safe Google login:
 * Complete OAuth on mypeer-501909.firebaseapp.com (registered redirect_uri),
 * then return a Google ID token to telltea-shop and signInWithCredential.
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

function consumeBridgeToken(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const token = params.get("google_id_token");
  if (!token) return null;
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  return token;
}

function shouldUseAuthBridge() {
  // localhost can keep popup; production always uses the firebaseapp bridge
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
      const bridgeToken = consumeBridgeToken();
      if (!bridgeToken) return;
      try {
        setStatus("loading");
        await signInWithCredential(auth, GoogleAuthProvider.credential(bridgeToken));
      } catch (err) {
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
