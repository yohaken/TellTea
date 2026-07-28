/** BO-controlled tablet sync cadence (meta/pos). */
import { doc, getDoc, setDoc } from "firebase/firestore";
import { getDb } from "./firebase";

export const HEARTBEAT_INTERVAL_DEFAULT_SEC = 5;
export const HEARTBEAT_INTERVAL_MIN_SEC = 5;
export const HEARTBEAT_INTERVAL_MAX_SEC = 600;

export const HEARTBEAT_INTERVAL_PRESETS = [5, 10, 15, 30, 60, 120, 300] as const;

export function clampHeartbeatIntervalSec(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return HEARTBEAT_INTERVAL_DEFAULT_SEC;
  const sec = Math.round(n);
  if (sec < HEARTBEAT_INTERVAL_MIN_SEC) return HEARTBEAT_INTERVAL_MIN_SEC;
  if (sec > HEARTBEAT_INTERVAL_MAX_SEC) return HEARTBEAT_INTERVAL_MAX_SEC;
  return sec;
}

function metaPosRef() {
  return doc(getDb(), "meta", "pos");
}

export async function getHeartbeatIntervalSec(): Promise<number> {
  const snap = await getDoc(metaPosRef());
  const data = snap.data() as Record<string, unknown> | undefined;
  return clampHeartbeatIntervalSec(data?.heartbeatIntervalSec);
}

export async function setHeartbeatIntervalSec(sec: number): Promise<number> {
  const next = clampHeartbeatIntervalSec(sec);
  await setDoc(
    metaPosRef(),
    {
      heartbeatIntervalSec: next,
      heartbeatIntervalUpdatedAt: Date.now(),
    },
    { merge: true },
  );
  return next;
}
