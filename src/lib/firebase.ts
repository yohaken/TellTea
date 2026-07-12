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

/**
 * Keep authDomain on the Firebase default host.
 * TellTea production login uses the firebaseapp auth bridge.
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

export const OWNER_EMAIL = (process.env.NEXT_PUBLIC_OWNER_EMAIL || "yohaken@gmail.com")
  .trim()
  .toLowerCase();

/** เจ้าของร้านคนเดียว — ใช้เปิดฟีเจอร์ทดลองก่อนปล่อยให้พนักงาน */
export function isAppOwnerEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === OWNER_EMAIL;
}
