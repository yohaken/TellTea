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

/**
 * Keep authDomain on the Firebase default host.
 * Custom hosting domains (telltea-shop.web.app) need an extra OAuth redirect URI
 * in Google Cloud Console — without it mobile redirect shows "blocked"/mismatch.
 * Popup + firebaseapp.com authDomain works on phone browsers without that step.
 */
const PROJECT_DEFAULTS = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "",
  authDomain:
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "mypeer-501909.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "",
};

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
    app = getApps().length ? getApps()[0]! : initializeApp(PROJECT_DEFAULTS);
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
