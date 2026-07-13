/**
 * Isolated Firebase app for POS tablets — must NOT share Auth with TellTea หลังร้าน.
 * Same project, separate Auth persistence so /pos/ never signs out Google staff/owner.
 */
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  type Auth,
} from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
  type Firestore,
} from "firebase/firestore";
import { getFunctions, type Functions } from "firebase/functions";
import { isFirebaseConfigured } from "./firebase";

const POS_APP_NAME = "telltea-pos";

const PROJECT_DEFAULTS = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "",
  authDomain:
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "mypeer-501909.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "",
};

let posApp: FirebaseApp | undefined;
let posAuth: Auth | undefined;
let posDb: Firestore | undefined;
let posFunctions: Functions | undefined;

function getPosFirebaseApp(): FirebaseApp {
  if (!isFirebaseConfigured()) {
    throw new Error("Firebase ยังไม่ได้ตั้งค่า — ดู README");
  }
  if (!posApp) {
    const existing = getApps().find((a) => a.name === POS_APP_NAME);
    posApp = existing ?? initializeApp(PROJECT_DEFAULTS, POS_APP_NAME);
  }
  return posApp;
}

export function getPosFirebaseAuth(): Auth {
  if (!posAuth) {
    const app = getPosFirebaseApp();
    try {
      posAuth = initializeAuth(app, {
        persistence: [indexedDBLocalPersistence, browserLocalPersistence],
      });
    } catch {
      posAuth = getAuth(app);
    }
  }
  return posAuth;
}

export function getPosDb(): Firestore {
  if (!posDb) {
    const app = getPosFirebaseApp();
    try {
      posDb = initializeFirestore(app, {
        localCache: persistentLocalCache({
          tabManager: persistentSingleTabManager({}),
        }),
      });
    } catch {
      posDb = getFirestore(app);
    }
  }
  return posDb;
}

export function getPosFirebaseFunctions(): Functions {
  if (!posFunctions) {
    posFunctions = getFunctions(getPosFirebaseApp(), "asia-southeast1");
  }
  return posFunctions;
}
