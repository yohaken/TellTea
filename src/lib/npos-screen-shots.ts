import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { mapFirestoreError } from "./firestore-errors";

export const NPOS_SCREEN_SHOTS_COL = "nposScreenShots";

export type NposScreenShot = {
  id: string;
  installId: string;
  capturedAt: number;
  reason: string;
  primaryUrl: string;
  secondaryUrl: string;
  primaryOk: boolean;
  secondaryOk: boolean;
};

function mapShot(id: string, data?: Record<string, unknown> | null): NposScreenShot {
  const primary = (data?.primary && typeof data.primary === "object"
    ? data.primary
    : {}) as Record<string, unknown>;
  const secondary = (data?.secondary && typeof data.secondary === "object"
    ? data.secondary
    : {}) as Record<string, unknown>;
  return {
    id,
    installId: typeof data?.installId === "string" ? data.installId : "",
    capturedAt: typeof data?.capturedAt === "number" ? data.capturedAt : 0,
    reason: typeof data?.reason === "string" ? data.reason : "",
    primaryUrl: typeof primary.url === "string" ? primary.url : "",
    secondaryUrl: typeof secondary.url === "string" ? secondary.url : "",
    primaryOk: primary.ok === true,
    secondaryOk: secondary.ok === true,
  };
}

/** Server keeps ≤50 per install; BO timeline defaults to 50 newest. */
export const NPOS_CAPTURE_MAX_KEEP = 50;

/** Recent capture docs for BO timeline (newest first). */
export function subscribeNposScreenShots(
  onData: (shots: NposScreenShot[]) => void,
  onError?: (err: Error) => void,
  max = NPOS_CAPTURE_MAX_KEEP,
): Unsubscribe {
  const q = query(
    collection(getDb(), NPOS_SCREEN_SHOTS_COL),
    orderBy("capturedAt", "desc"),
    limit(Math.max(1, Math.min(NPOS_CAPTURE_MAX_KEEP, max))),
  );
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => mapShot(d.id, d.data() as Record<string, unknown>)));
    },
    (err) => {
      onError?.(
        err instanceof Error
          ? err
          : new Error(mapFirestoreError(err, "โหลดประวัติแคปจอ", "pos")),
      );
    },
  );
}

export function formatCaptureAt(ts: number): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("th-TH");
  } catch {
    return String(ts);
  }
}
