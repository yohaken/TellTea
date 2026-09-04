import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  type Auth,
} from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";
import { getFunctions, type Functions } from "firebase/functions";
import { getStorage, type FirebaseStorage } from "firebase/storage";

/**
 * authDomain ต้องอยู่โดเมนเดียวกับแอป (Option 1 ใน Firebase redirect best practices)
 * ไม่งั้นมือถือ Safari/Chrome จะเจอ "missing initial state" หลัง Google redirect
 * เพราะ sessionStorage ข้ามโดเมนถูกบล็อก
 */
export function resolveAuthDomain(): string {
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    // Hosting ที่เสิร์ฟ /__/auth/handler จริง — ใช้โดเมนนั้นเป็น authDomain
    if (host === "telltea-bo.web.app" || host === "telltea-pos.web.app") {
      return host;
    }
    // localhost/127.0.0.1: ห้ามตั้ง authDomain=localhost (Next ไม่มี auth handler)
    // → ใช้โดเมนโปรเจกต์ + ใส่ localhost ใน Authorized domains แทน
  }
  return (
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||
    "mypeer-501909.firebaseapp.com"
  );
}

/** Local BO bypass — ใช้ได้เฉพาะ localhost เมื่อเปิด NEXT_PUBLIC_DEV_OWNER_BYPASS=1 */
export function isLocalDevHost(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
}

export function isLocalDevOwnerBypassEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_DEV_OWNER_BYPASS !== "1") return false;
  return isLocalDevHost();
}

function firebaseConfig() {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "",
    authDomain: resolveAuthDomain(),
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "",
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "",
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "",
  };
}

export function isFirebaseConfigured() {
  const cfg = firebaseConfig();
  return Boolean(cfg.apiKey && cfg.authDomain && cfg.projectId && cfg.appId);
}

export function isFirebaseStorageConfigured() {
  return isFirebaseConfigured() && Boolean(firebaseConfig().storageBucket?.trim());
}

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;
let functions: Functions | undefined;
let storage: FirebaseStorage | undefined;

export function getFirebaseApp() {
  if (!isFirebaseConfigured()) {
    throw new Error("Firebase ยังไม่ได้ตั้งค่า — ดู README");
  }
  if (!app) {
    app = getApps().length ? getApps()[0]! : initializeApp(firebaseConfig());
  }
  return app;
}

export function getFirebaseAuth() {
  if (!auth) {
    const firebaseApp = getFirebaseApp();
    try {
      auth = initializeAuth(firebaseApp, {
        persistence: [indexedDBLocalPersistence, browserLocalPersistence],
        popupRedirectResolver: browserPopupRedirectResolver,
      });
    } catch {
      auth = getAuth(firebaseApp);
    }
  }
  return auth;
}

export function getDb() {
  if (!db) {
    const firebaseApp = getFirebaseApp();
    try {
      db = initializeFirestore(firebaseApp, {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      });
    } catch {
      db = getFirestore(firebaseApp);
    }
  }
  return db;
}

export function getFirebaseFunctions() {
  if (!functions) {
    functions = getFunctions(getFirebaseApp(), "asia-southeast1");
  }
  return functions;
}

export function getFirebaseStorage() {
  if (!isFirebaseStorageConfigured()) {
    throw new Error("Firebase Storage ยังไม่ได้ตั้งค่า");
  }
  if (!storage) {
    storage = getStorage(getFirebaseApp());
  }
  return storage;
}

export const OWNER_EMAIL = (process.env.NEXT_PUBLIC_OWNER_EMAIL || "yohaken@gmail.com")
  .trim()
  .toLowerCase();

/** เจ้าของร้านคนเดียว — ใช้เปิดฟีเจอร์ทดลองก่อนปล่อยให้พนักงาน */
export function isAppOwnerEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === OWNER_EMAIL;
}
