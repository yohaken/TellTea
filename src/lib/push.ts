import { doc, setDoc, deleteDoc } from "firebase/firestore";
import { getDb } from "./firebase";

const VAPID_PUBLIC =
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
  "BI74S6JyDs61V0eqRuS9iy6XdhER9wtA-EXhLfWiEFZSeg2VBBQM1dnPnFsyVY2AQzcKF7gHZm-Eifpsc7cF0Zg";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

function subscriptionId(endpoint: string) {
  let hash = 0;
  for (let i = 0; i < endpoint.length; i += 1) {
    hash = (hash * 31 + endpoint.charCodeAt(i)) >>> 0;
  }
  return `web_${hash.toString(16)}`;
}

export function pushSupported() {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

export async function ensurePushServiceWorker() {
  if (!pushSupported()) throw new Error("อุปกรณ์นี้ไม่รองรับการแจ้งเตือน");
  return navigator.serviceWorker.register("/sw.js");
}

/** Owner: request permission, subscribe, store endpoint for Cloud Function. */
export async function enableOwnerPush(email: string): Promise<"granted" | "denied" | "unsupported"> {
  if (!pushSupported()) return "unsupported";

  const permission =
    Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();
  if (permission !== "granted") return "denied";

  const reg = await ensurePushServiceWorker();
  await navigator.serviceWorker.ready;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
    });
  }

  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("สมัครแจ้งเตือนไม่สำเร็จ");
  }

  const id = subscriptionId(json.endpoint);
  await setDoc(doc(getDb(), "pushSubscriptions", id), {
    id,
    email: email.trim().toLowerCase(),
    role: "owner",
    endpoint: json.endpoint,
    keys: {
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    },
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 240) : "",
    updatedAt: Date.now(),
  });

  return "granted";
}

export async function disableOwnerPush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  const id = subscriptionId(sub.endpoint);
  await sub.unsubscribe().catch(() => undefined);
  await deleteDoc(doc(getDb(), "pushSubscriptions", id)).catch(() => undefined);
}

export async function showLocalLowBalanceNotification(balanceLabel: string, thresholdLabel: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const reg = await navigator.serviceWorker.getRegistration();
  const title = "TellTea — เงินคงเหลือต่ำ";
  const body = `คงเหลือ ${balanceLabel} (ต่ำกว่า ${thresholdLabel}) — โอนเข้าได้เลย`;
  const opts = {
    body,
    tag: "telltea-low-balance",
    renotify: true,
    data: { url: "https://telltea-shop.web.app/in/" },
  } as NotificationOptions;

  if (reg?.showNotification) {
    await reg.showNotification(title, opts);
  } else {
    new Notification(title, opts);
  }
}
