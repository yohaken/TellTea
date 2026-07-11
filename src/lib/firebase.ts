import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  type Auth,
} from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

const PROJECT_DEFAULTS = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "mypeer-501909.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "",
};

/**
 * On mobile, redirect login must stay same-origin.
 * Using firebaseapp.com while the app is on telltea-shop.web.app breaks session restore
 * (Safari/Chrome partitioned storage). Prefer the current Hosting hostname when allowed.
 */
export function resolveAuthDomain(): string {
  if (typeof window === "undefined") {
    return PROJECT_DEFAULTS.authDomain;
  }
  const host = window.location.hostname;
  const allowed = new Set([
    "localhost",
    "127.0.0.1",
    "telltea-shop.web.app",
    "telltea-shop.firebaseapp.com",
    "mypeer-501909.web.app",
    "mypeer-501909.firebaseapp.com",
  ]);
  if (allowed.has(host)) {
    return host === "localhost" || host === "127.0.0.1"
      ? PROJECT_DEFAULTS.authDomain
      : host;
  }
  return PROJECT_DEFAULTS.authDomain;
}

export function isFirebaseConfigured() {
  return Boolean(
    PROJECT_DEFAULTS.apiKey &&
      PROJECT_DEFAULTS.authDomain &&
      PROJECT_DEFAULTS.projectId &&
      PROJECT_DEFAULTS.appId,
  );
}

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;

export function getFirebaseApp() {
  if (!isFirebaseConfigured()) {
    throw new Error("Firebase ยังไม่ได้ตั้งค่า — ดู README");
  }
  if (!app) {
    const config = {
      ...PROJECT_DEFAULTS,
      authDomain: resolveAuthDomain(),
    };
    app = getApps().length ? getApps()[0]! : initializeApp(config);
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
      // Already initialized (HMR / remount)
      auth = getAuth(firebaseApp);
    }
  }
  return auth;
}

export function getDb() {
  if (!db) {
    db = getFirestore(getFirebaseApp());
  }
  return db;
}

export const OWNER_EMAIL = (process.env.NEXT_PUBLIC_OWNER_EMAIL || "yohaken@gmail.com")
  .trim()
  .toLowerCase();
