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
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
  type ConfirmationResult,
  type User,
} from "firebase/auth";
import { deleteDoc, doc, getDocFromServer } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { clearAppCaches, loadCachedStaff, saveCachedStaff } from "./cache";
import {
  getDb,
  getFirebaseAuth,
  getFirebaseFunctions,
  isAppOwnerEmail,
  isFirebaseConfigured,
} from "./firebase";
import { confirmPhoneOtp, resetPhoneRecaptcha, sendPhoneOtp } from "./phone-auth";
import { migrateAllBonusCloseSideDocs } from "./bonus-close-migrate";
import { migrateAllLegacyEmployeePay } from "./employees";
import { migrateAllLegacyStockCosts } from "./stock";
import { withTimeout } from "./pos-timeout";
import {
  ensureOwnerBootstrap,
  getStaffByEmailIndex,
  getStaffByPhone,
  getStaffMemberById,
  attachStaffPersonal,
} from "./staff";
import type { StaffMember } from "./types";
import { normalizeEmail, staffAccountLabel } from "./utils";
import {
  buildPreviewStaff,
  loadPermPreview,
  normalizePreviewInput,
  savePermPreview,
  type PermPreviewStartInput,
  type PermPreviewState,
} from "./perm-preview";
import { withResolvedPermissions } from "./permissions";
import {
  ensurePermissionLevelSeeds,
  subscribePermissionLevels,
} from "./permission-levels";
import type { PermissionLevel } from "./types";

type AuthStatus = "loading" | "signedOut" | "denied" | "ready" | "unconfigured";

/** Why status is loading — boot must not look like a stuck Google login. */
export type AuthBusyReason = "boot" | "bridge" | "staff" | null;

/** One server read of login ticket — short; we retry a few times. */
export const AUTH_BRIDGE_TIMEOUT_MS = 8_000;
/** Staff doc resolve after Auth — fail instead of AuthGate forever. */
export const AUTH_STAFF_RESOLVE_TIMEOUT_MS = 12_000;
/** Admin callable is optional once Firestore already found the roster row. */
export const AUTH_STAFF_CALLABLE_TIMEOUT_MS = 4_000;
/** Escape hatch if loading never clears (AuthGate / login). */
export const AUTH_LOADING_ESCAPE_MS = 18_000;

const LOGIN_TICKET_SESSION_KEY = "telltea_login_ticket";
/** Same-origin Google redirect pending (staff BO — ไม่ใช้ตั๋วข้ามโดเมน). */
const STAFF_GOOGLE_PENDING_KEY = "telltea_staff_google_pending";

type AuthContextValue = {
  status: AuthStatus;
  /** null when not loading · boot = session check · bridge = Google ticket · staff = rights */
  busyReason: AuthBusyReason;
  user: User | null;
  /** สิทธิ์/บทบาทที่ใช้โชว์เมนู — อาจเป็นพรีวิว · permissions ถูก resolve แล้ว */
  staff: StaffMember | null;
  /** บัญชีจริงที่ล็อกอิน (ไม่ถูกพรีวิวทับ) · permissions resolve แล้ว */
  realStaff: StaffMember | null;
  /** แคตตาล็อกลำดับสิทธิ์ — ใช้พรีวิว/resolve */
  permissionLevels: PermissionLevel[];
  /** true เมื่อเจ้าของกำลังดูมุมมองตามสิทธิ์พนักงาน */
  isPermPreview: boolean;
  permPreview: PermPreviewState | null;
  actorId: string;
  error: string | null;
  signIn: () => Promise<void>;
  sendPhoneLoginOtp: (phone: string, recaptchaContainerId: string) => Promise<void>;
  confirmPhoneLoginOtp: (code: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshStaff: () => Promise<void>;
  startPermPreview: (input: PermPreviewStartInput) => void;
  stopPermPreview: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Legacy cross-domain bridge (P-Note). ไม่ใช่ทางหลักแล้ว —
 * คง URL ไว้เผื่อแลกตั๋วเก่าที่ยังค้างในลิงก์
 */
export const TELLTEA_AUTH_BRIDGE =
  "https://mypeer-501909.firebaseapp.com/telltea-auth.html";

/** Map Firebase Auth errors to short Thai — never surface raw `Firebase: Error (...)`. */
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
    code === "auth/network-request-failed" ||
    /missing initial state|sessionStorage is inaccessible|storage-partitioned/i.test(message)
  ) {
    return "เข้า Google ไม่สำเร็จ — เปิดใน Chrome/Safari (ไม่ใช่ใน LINE) แล้วลองใหม่ หรือใช้เบอร์แทน";
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
  if (code === "auth/captcha-check-failed" || code === "auth/invalid-app-credential") {
    return "ยืนยันตัวตนไม่ผ่าน — รีเฟรชหน้าแล้วลองใหม่";
  }
  if (code === "permission-denied") {
    return "อ่านสิทธิ์พนักงานไม่ได้ — ลองออกแล้วเข้าใหม่";
  }
  if (/Firebase:\s*Error|auth\/[a-z0-9-]+/i.test(message)) {
    return "เข้าสู่ระบบไม่สำเร็จ — ลองใหม่ หรือใช้เบอร์แทน";
  }
  return message || "การล็อกอินล้มเหลว";
}

function mapAuthError(error: unknown) {
  return mapFirebaseAuthError(error);
}

/**
 * Legacy only — cross-domain bridge (P-Note / telltea-auth.html).
 * ค่าเริ่มต้นปิด: พนักงานใช้ same-origin popup/redirect แทน
 * เปิดด้วย NEXT_PUBLIC_FORCE_AUTH_BRIDGE=1 เท่านั้น
 */
export function shouldUseGoogleAuthBridge(): boolean {
  if (typeof window === "undefined") return false;
  if (process.env.NEXT_PUBLIC_FORCE_AUTH_BRIDGE === "1") return true;
  return false;
}

export function startGoogleAuthBridge(returnUrl: string) {
  const ret = (returnUrl || "").trim() || (typeof window !== "undefined" ? window.location.href : "");
  window.location.assign(
    `${TELLTEA_AUTH_BRIDGE}?return=${encodeURIComponent(ret)}`,
  );
}

/**
 * If URL has `?ticket=` from the auth bridge, exchange it for a Google session.
 * @returns true when a ticket was present (success or throw).
 */
export async function completeGoogleAuthBridgeFromUrl(): Promise<boolean> {
  return exchangeBridgeTicketIfPresent();
}

/** Desktop / wide pointer: popup on same origin (ไม่พึ่ง Firestore ticket). */
function shouldPreferStaffGooglePopup() {
  if (typeof window === "undefined") return true;
  if (process.env.NEXT_PUBLIC_FORCE_AUTH_BRIDGE === "1") return false;
  if (process.env.NEXT_PUBLIC_FORCE_POPUP_AUTH === "1") return true;
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return true;
  try {
    if (window.matchMedia("(pointer: fine) and (min-width: 768px)").matches) return true;
  } catch {
    /* ignore */
  }
  return false;
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

async function resolveStaffViaCallable(user: User): Promise<StaffMember | null> {
  try {
    const fn = httpsCallable<
      Record<string, never>,
      {
        ok?: boolean;
        staff?: StaffMember | null;
        claimUpdated?: boolean;
      }
    >(getFirebaseFunctions(), "resolveMyStaff");
    const res = await withTimeout(
      fn({}),
      AUTH_STAFF_CALLABLE_TIMEOUT_MS,
      "ตรวจสิทธิ์หมดเวลา — รีเฟรชแล้วลองใหม่",
    );
    const payload = res.data;
    if (!payload?.ok || !payload.staff?.id) return null;
    if (payload.claimUpdated) {
      try {
        await user.getIdToken(true);
      } catch {
        /* claim still applies on next refresh */
      }
    }
    return payload.staff;
  } catch {
    return null;
  }
}

function ownerFallbackMember(user: User, email: string): StaffMember {
  return {
    id: email,
    email,
    role: "owner",
    displayName: user.displayName || undefined,
    profileComplete: true,
    createdAt: Date.now(),
  };
}

/** Firestore roster lookup — never throw (rules flake must not kick the user out). */
async function resolveStaffLocal(user: User): Promise<StaffMember | null> {
  const email = emailFromUser(user);
  if (email) {
    try {
      const bootstrapped = await ensureOwnerBootstrap(email, user.displayName);
      if (bootstrapped) return bootstrapped;
    } catch {
      /* permission / offline */
    }
    try {
      const byId = await getStaffMemberById(email);
      if (byId) return byId;
    } catch {
      /* ignore */
    }
    try {
      const byIdx = await getStaffByEmailIndex(email);
      if (byIdx) return byIdx;
    } catch {
      /* ignore */
    }
    if (isAppOwnerEmail(email)) {
      return ownerFallbackMember(user, email);
    }
  }
  if (user.phoneNumber) {
    try {
      const byPhone = await getStaffByPhone(user.phoneNumber);
      if (byPhone) return byPhone;
    } catch {
      /* ignore */
    }
  }
  return null;
}

async function attachPersonalIfStaff(member: StaffMember): Promise<StaffMember> {
  if (member.role !== "staff") return member;
  try {
    return await attachStaffPersonal(member);
  } catch {
    return member;
  }
}

async function resolveStaff(user: User): Promise<StaffMember | null> {
  const local = await resolveStaffLocal(user);
  // Local hit (owner / email doc / phone index) — enter immediately.
  // Callable is enhancement (claim + p_* migrate). Waiting on it during
  // function deploys caused BOTH Google and phone logins to bounce.
  if (local) {
    void resolveStaffViaCallable(user);
    return attachPersonalIfStaff(local);
  }
  const fromServer = await resolveStaffViaCallable(user);
  if (fromServer) return attachPersonalIfStaff(fromServer);
  const email = emailFromUser(user);
  if (isAppOwnerEmail(email)) {
    return ownerFallbackMember(user, email);
  }
  return null;
}

function clearSavedLoginTicket() {
  try {
    sessionStorage.removeItem(LOGIN_TICKET_SESSION_KEY);
  } catch {
    /* private mode */
  }
}

/**
 * เก็บ ticket ใน sessionStorage ก่อนลบจาก URL —
 * กัน remount/effect ซ้ำแล้วทำตั๋วหายกลางคัน
 */
function takeTicketFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const fromQuery = (url.searchParams.get("ticket") || "").trim();
  if (fromQuery) {
    try {
      sessionStorage.setItem(LOGIN_TICKET_SESSION_KEY, fromQuery);
    } catch {
      /* private mode */
    }
    url.searchParams.delete("ticket");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    return fromQuery;
  }
  try {
    return (sessionStorage.getItem(LOGIN_TICKET_SESSION_KEY) || "").trim() || null;
  } catch {
    return null;
  }
}

async function idTokenFromTicketClient(ticket: string): Promise<string> {
  const ref = doc(getDb(), "loginTickets", ticket);
  let lastErr: unknown = null;
  // อ่านจากเซิร์ฟเวอร์ตรงๆ — เลี่ยง IndexedDB cache ที่เคยทำให้ getDoc ค้างจน timeout
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const snap = await withTimeout(
        getDocFromServer(ref),
        AUTH_BRIDGE_TIMEOUT_MS,
        "อ่านตั๋วล็อกอินหมดเวลา — กดเข้าสู่ระบบอีกครั้ง",
      );
      if (!snap.exists()) {
        clearSavedLoginTicket();
        throw new Error("ลิงก์ล็อกอินหมดอายุหรือใช้แล้ว — กดเข้าสู่ระบบอีกครั้ง");
      }
      const data = snap.data() as { idToken?: string; exp?: number };
      void deleteDoc(ref).catch(() => undefined);
      clearSavedLoginTicket();
      if (!data.idToken) {
        throw new Error("ลิงก์ล็อกอินไม่ถูกต้อง — กดเข้าสู่ระบบอีกครั้ง");
      }
      if (data.exp && data.exp < Date.now()) {
        throw new Error("ลิงก์ล็อกอินหมดอายุ — กดเข้าสู่ระบบอีกครั้ง");
      }
      return data.idToken;
    } catch (err) {
      lastErr = err;
      const code = (err as { code?: string })?.code || "";
      const message = (err as Error)?.message || "";
      if (code === "permission-denied" || /insufficient permissions/i.test(message)) {
        clearSavedLoginTicket();
        throw new Error("อ่านตั๋วล็อกอินไม่ได้ — กดเข้าสู่ระบบอีกครั้ง");
      }
      // หมดอายุ/ใช้แล้ว — ไม่ retry
      if (/หมดอายุ|ใช้แล้ว|ไม่ถูกต้อง/.test(message) && !/อ่านตั๋วล็อกอินหมดเวลา/.test(message)) {
        clearSavedLoginTicket();
        throw err;
      }
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
        continue;
      }
    }
  }
  clearSavedLoginTicket();
  if (lastErr instanceof Error) throw lastErr;
  throw new Error("อ่านตั๋วล็อกอินไม่สำเร็จ — กดเข้าสู่ระบบอีกครั้ง");
}

/** Prefer Admin SDK callable (bypasses client Firestore/cache); fall back to client get. */
async function idTokenFromTicket(ticket: string): Promise<string> {
  try {
    const fn = httpsCallable<{ ticket: string }, { idToken: string }>(
      getFirebaseFunctions(),
      "exchangeLoginTicket",
    );
    const res = await withTimeout(
      fn({ ticket }),
      AUTH_BRIDGE_TIMEOUT_MS,
      "อ่านตั๋วล็อกอินหมดเวลา — กดเข้าสู่ระบบอีกครั้ง",
    );
    const idToken = String(res.data?.idToken || "").trim();
    if (idToken) {
      clearSavedLoginTicket();
      return idToken;
    }
  } catch {
    /* fall through to client Firestore read */
  }
  return idTokenFromTicketClient(ticket);
}

/** แชร์ข้าม remount — กัน effect cleanup ทิ้งตั๋วกลางคันแล้วล็อกอินไม่สำเร็จ */
let bridgeExchangeInFlight: Promise<boolean> | null = null;
let staffRedirectInFlight: Promise<boolean> | null = null;

async function exchangeBridgeTicketIfPresent(): Promise<boolean> {
  const ticket = takeTicketFromUrl();
  if (!ticket) return false;
  if (!bridgeExchangeInFlight) {
    bridgeExchangeInFlight = (async () => {
      const idToken = await idTokenFromTicket(ticket);
      await withTimeout(
        signInWithCredential(
          getFirebaseAuth(),
          GoogleAuthProvider.credential(idToken),
        ),
        AUTH_BRIDGE_TIMEOUT_MS,
        "เข้า Google หมดเวลา — กดเข้าสู่ระบบอีกครั้ง",
      );
      return true;
    })().finally(() => {
      bridgeExchangeInFlight = null;
    });
  }
  return bridgeExchangeInFlight;
}

/** Same-origin Google redirect (มือถือ) — ไม่พึ่ง ticket ข้ามโดเมน */
async function completeStaffGoogleRedirect(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!staffRedirectInFlight) {
    staffRedirectInFlight = (async () => {
      // กันแย่ง getRedirectResult จากสมาชิก (/claim · /me · /gift) — คนละ session key
      try {
        if (sessionStorage.getItem("telltea_member_google_pending")) {
          return false;
        }
      } catch {
        /* ignore */
      }
      let pending = false;
      try {
        pending = sessionStorage.getItem(STAFF_GOOGLE_PENDING_KEY) === "1";
      } catch {
        /* ignore */
      }
      const auth = getFirebaseAuth();
      try {
        // ต้องเรียกทุกครั้งหลังกลับจาก Google (Firebase เก็บผลไว้จนกว่าจะ getRedirectResult)
        const resultPromise = getRedirectResult(auth);
        const result = pending
          ? await withTimeout(
              resultPromise,
              AUTH_BRIDGE_TIMEOUT_MS,
              "ยืนยันตัวตนหมดเวลา — กดเข้าสู่ระบบอีกครั้ง",
            )
          : await resultPromise;
        if (result?.user) {
          try {
            sessionStorage.removeItem(STAFF_GOOGLE_PENDING_KEY);
          } catch {
            /* ignore */
          }
          return true;
        }
        if (pending && auth.currentUser) {
          try {
            sessionStorage.removeItem(STAFF_GOOGLE_PENDING_KEY);
          } catch {
            /* ignore */
          }
          return true;
        }
      } catch (err) {
        const code = (err as { code?: string })?.code || "";
        if (code === "auth/credential-already-in-use" || code === "auth/email-already-in-use") {
          try {
            sessionStorage.removeItem(STAFF_GOOGLE_PENDING_KEY);
          } catch {
            /* ignore */
          }
          return true;
        }
        // Timeout / flake: if Google already left a session, keep it
        if (auth.currentUser) {
          try {
            sessionStorage.removeItem(STAFF_GOOGLE_PENDING_KEY);
          } catch {
            /* ignore */
          }
          return true;
        }
        if (pending) throw err;
      }
      return false;
    })().finally(() => {
      staffRedirectInFlight = null;
    });
  }
  return staffRedirectInFlight;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(() =>
    isFirebaseConfigured() ? "loading" : "unconfigured",
  );
  const [busyReason, setBusyReason] = useState<AuthBusyReason>(() =>
    isFirebaseConfigured() ? "boot" : null,
  );
  const [user, setUser] = useState<User | null>(null);
  const [staff, setStaff] = useState<StaffMember | null>(null);
  const [permissionLevels, setPermissionLevels] = useState<PermissionLevel[]>([]);
  const [permPreview, setPermPreview] = useState<PermPreviewState | null>(() => loadPermPreview());
  const [error, setError] = useState<string | null>(null);
  const [phoneConfirmation, setPhoneConfirmation] = useState<ConfirmationResult | null>(null);

  const refreshStaff = useCallback(async () => {
    if (!user) return;
    setBusyReason("staff");
    try {
      const member = await withTimeout(
        resolveStaff(user),
        AUTH_STAFF_RESOLVE_TIMEOUT_MS,
        "ตรวจสิทธิ์หมดเวลา — รีเฟรชแล้วลองใหม่",
      );
      setStaff(member);
      setStatus(member ? "ready" : "denied");
      setBusyReason(null);
    } catch (err) {
      setError(mapAuthError(err));
      setStatus((prev) => (prev === "ready" ? prev : "denied"));
      setBusyReason(null);
    }
  }, [user]);

  // แคตตาล็อกลำดับสิทธิ์ — resolve/can/พรีวิวใช้ชุดเดียวกัน
  // เจ้าของ: ซ่อม seed ระบบ (พนักงานร้านไม่มีบช./คลัง) + sync คนที่ผูก
  useEffect(() => {
    if (!isFirebaseConfigured()) return;
    if (status !== "ready" || !staff) {
      setPermissionLevels([]);
      return;
    }
    let cancelled = false;
    if (staff.role === "owner") {
      void ensurePermissionLevelSeeds()
        .then((levels) => {
          if (!cancelled && levels.length) setPermissionLevels(levels);
        })
        .catch(() => undefined);
    }
    const unsub = subscribePermissionLevels(
      (levels) => {
        if (!cancelled) setPermissionLevels(levels);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, [status, staff?.id, staff?.role]);

  const startPermPreview = useCallback(
    (input: PermPreviewStartInput) => {
      if (staff?.role !== "owner") return;
      const next = normalizePreviewInput(input);
      setPermPreview(next);
      savePermPreview(next);
    },
    [staff?.role],
  );

  const stopPermPreview = useCallback(() => {
    setPermPreview(null);
    savePermPreview(null);
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setStatus("unconfigured");
      setBusyReason(null);
      return;
    }

    const auth = getFirebaseAuth();
    let cancelled = false;
    let bridgePending = false;

    void (async () => {
      const hasTicket =
        Boolean(new URL(window.location.href).searchParams.get("ticket")) ||
        Boolean(
          (() => {
            try {
              return sessionStorage.getItem(LOGIN_TICKET_SESSION_KEY);
            } catch {
              return null;
            }
          })(),
        );
      let redirectPending = false;
      try {
        redirectPending = sessionStorage.getItem(STAFF_GOOGLE_PENDING_KEY) === "1";
      } catch {
        /* ignore */
      }
      // getRedirectResult ต้องรันทุกบูต; โชว์ bridge busy เฉพาะตอนมีตั๋ว/pending
      const showBridgeBusy = hasTicket || redirectPending || Boolean(bridgeExchangeInFlight);
      if (showBridgeBusy) {
        bridgePending = true;
        setBusyReason("bridge");
        setStatus("loading");
        setError(null);
      }
      try {
        await completeStaffGoogleRedirect();
        if (hasTicket || bridgeExchangeInFlight) {
          await exchangeBridgeTicketIfPresent();
        }
      } catch (err) {
        if (!cancelled) setError(mapAuthError(err));
      } finally {
        if (showBridgeBusy) {
          bridgePending = false;
          if (!cancelled && !auth.currentUser) {
            setBusyReason(null);
            setStatus("signedOut");
          }
        }
      }
    })();

    // Don't leave mobile users stuck on boot "กำลังเตรียมระบบ..."
    const readyTimeout = window.setTimeout(() => {
      if (!cancelled && !bridgePending && !auth.currentUser) {
        setBusyReason(null);
        setStatus((prev) => (prev === "loading" ? "signedOut" : prev));
      }
    }, 6000);

    void auth.authStateReady().then(() => {
      if (cancelled || bridgePending) return;
      if (!auth.currentUser) {
        setBusyReason(null);
        setStatus((prev) => (prev === "loading" ? "signedOut" : prev));
      }
    });

    const unsub = onAuthStateChanged(auth, async (next) => {
      if (cancelled) return;
      if (!next) {
        if (bridgePending) return;
        clearAppCaches();
        void import("./staff-work-load")
          .then(({ clearStaffIdentityPrefetch }) => clearStaffIdentityPrefetch())
          .catch(() => undefined);
        resetPhoneRecaptcha();
        setPhoneConfirmation(null);
        setUser(null);
        setStaff(null);
        setPermPreview(null);
        savePermPreview(null);
        setBusyReason(null);
        setStatus("signedOut");
        return;
      }
      setError(null);
      setUser(next);

      const cacheKey = cacheKeyFromUser(next);
      const cached =
        (cacheKey ? loadCachedStaff(cacheKey) : null) ||
        (next.phoneNumber ? loadCachedStaff(next.phoneNumber) : null) ||
        (emailFromUser(next) ? loadCachedStaff(emailFromUser(next)) : null);
      if (cached) {
        setStaff(cached);
        setBusyReason(null);
        setStatus("ready");
      } else {
        setBusyReason("staff");
        setStatus("loading");
      }

      try {
        const member = await withTimeout(
          resolveStaff(next),
          AUTH_STAFF_RESOLVE_TIMEOUT_MS,
          "ตรวจสิทธิ์หมดเวลา — รีเฟรชแล้วลองใหม่",
        );
        if (cancelled) return;
        setStaff(member);
        if (member) {
          saveCachedStaff(member);
          setBusyReason(null);
          setStatus("ready");
          // ปักเข้าหลังสุดทันทีตอนล็อกอินสำเร็จ (ไม่รอ heartbeat / visibility)
          void import("./staff-presence")
            .then(async ({ touchStaffPresence }) => {
              if (await touchStaffPresence(member.id)) return;
              // token/rules ยังไม่พร้อม — ลองใหม่สั้นๆ
              for (const delay of [2_000, 8_000]) {
                await new Promise((r) => setTimeout(r, delay));
                if (await touchStaffPresence(member.id)) return;
              }
            })
            .catch(() => undefined);
          // ย้ายเงินเดือน/บัญชีออกจาก employees → employeePay (ครั้งแรกหลัง deploy)
          if (member.role === "owner") {
            void migrateAllLegacyEmployeePay().catch(() => undefined);
            void migrateAllLegacyStockCosts().catch(() => undefined);
            void migrateAllBonusCloseSideDocs().catch(() => undefined);
          } else {
            void import("./staff-work-load")
              .then(({ prefetchStaffIdentity }) => prefetchStaffIdentity(member))
              .catch(() => undefined);
          }
        } else {
          clearAppCaches();
          void import("./staff-work-load")
            .then(({ clearStaffIdentityPrefetch }) => clearStaffIdentityPrefetch())
            .catch(() => undefined);
          setBusyReason(null);
          setStatus("denied");
        }
      } catch (err) {
        if (cancelled) return;
        const code = (err as { code?: string })?.code || "";
        const message = (err as Error)?.message || "";
        const timedOut = /หมดเวลา/.test(message);
        const permissionDenied =
          code === "permission-denied" || /insufficient permissions/i.test(message);
        // อย่าเด้งออกถ้าแคชยังตรงบัญชีนี้ — โชว์ข้อผิดพลาดแล้วให้ใช้งานต่อได้
        if ((permissionDenied || timedOut) && cached?.id) {
          setError(mapAuthError(err));
          setStaff(cached);
          setBusyReason(null);
          setStatus("ready");
          // ยังปัก presence จากแคช — อย่าให้สถานะค้างเพราะ resolve ล้มชั่วคราว
          void import("./staff-presence")
            .then(({ touchStaffPresence }) => touchStaffPresence(cached.id))
            .catch(() => undefined);
          return;
        }
        if (permissionDenied) {
          clearAppCaches();
          setError(mapAuthError(err));
          setStaff(null);
          setBusyReason(null);
          setStatus("denied");
          return;
        }
        if (cached?.id) {
          setError(null);
          setBusyReason(null);
          setStatus("ready");
          return;
        }
        setError(mapAuthError(err));
        setStaff(null);
        setBusyReason(null);
        // timeout / network — back to login with retry, not infinite spinner
        setStatus(timedOut ? "signedOut" : "denied");
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

    // Legacy escape hatch only — ไม่ใช้เป็นค่าเริ่มต้น (ตั๋วข้ามโดเมนมัก timeout)
    if (shouldUseGoogleAuthBridge()) {
      const returnTo = `${window.location.origin}/login/`;
      startGoogleAuthBridge(returnTo);
      return;
    }

    const auth = getFirebaseAuth();
    const provider = new GoogleAuthProvider();
    provider.addScope("email");
    provider.addScope("profile");
    provider.setCustomParameters({ prompt: "select_account" });
    try {
      try {
        await signInWithPopup(auth, provider);
        return;
      } catch (popupErr) {
        const code = (popupErr as { code?: string })?.code || "";
        if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
          throw popupErr;
        }
        if (
          shouldPreferStaffGooglePopup() &&
          code !== "auth/popup-blocked" &&
          code !== "auth/operation-not-supported-in-this-environment"
        ) {
          throw popupErr;
        }
      }
      // มือถือ / popup ถูกบล็อก: same-origin redirect
      try {
        sessionStorage.setItem(STAFF_GOOGLE_PENDING_KEY, "1");
      } catch {
        /* private mode */
      }
      setBusyReason("bridge");
      setStatus("loading");
      await signInWithRedirect(auth, provider);
    } catch (err) {
      try {
        sessionStorage.removeItem(STAFF_GOOGLE_PENDING_KEY);
      } catch {
        /* ignore */
      }
      setBusyReason(null);
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
    void import("./staff-work-load")
      .then(({ clearStaffIdentityPrefetch }) => clearStaffIdentityPrefetch())
      .catch(() => undefined);
    resetPhoneRecaptcha();
    setPhoneConfirmation(null);
    setPermPreview(null);
    savePermPreview(null);
    await firebaseSignOut(getFirebaseAuth());
  }, []);

  const isPermPreview = !!(permPreview && staff?.role === "owner");
  // บัญชีจริง + พรีวิว: permissions ต้องผ่าน resolveEffectivePermissions เสมอ
  const realStaff = useMemo(
    () => withResolvedPermissions(staff, permissionLevels),
    [staff, permissionLevels],
  );
  const effectiveStaff = useMemo(() => {
    if (isPermPreview && permPreview && staff) {
      return withResolvedPermissions(
        buildPreviewStaff(staff, permPreview),
        permissionLevels,
      );
    }
    return realStaff;
  }, [isPermPreview, permPreview, staff, permissionLevels, realStaff]);
  // เขียนข้อมูลยังเป็นบัญชีจริง — ห้ามใช้ effectiveStaff (พรีวิวสวม memberId คนอื่น)
  const actorId = actorIdFromUser(user, realStaff);

  const value = useMemo(
    () => ({
      status,
      busyReason: status === "loading" ? busyReason : null,
      user,
      staff: effectiveStaff,
      realStaff,
      permissionLevels,
      isPermPreview,
      permPreview: isPermPreview ? permPreview : null,
      actorId,
      error,
      signIn,
      sendPhoneLoginOtp,
      confirmPhoneLoginOtp,
      signOut,
      refreshStaff,
      startPermPreview,
      stopPermPreview,
    }),
    [
      status,
      busyReason,
      user,
      effectiveStaff,
      realStaff,
      permissionLevels,
      isPermPreview,
      permPreview,
      actorId,
      error,
      signIn,
      sendPhoneLoginOtp,
      confirmPhoneLoginOtp,
      signOut,
      refreshStaff,
      startPermPreview,
      stopPermPreview,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
