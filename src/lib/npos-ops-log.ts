import {
  collection,
  onSnapshot,
  orderBy,
  query,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { mapFirestoreError } from "./firestore-errors";

export const NPOS_OPS_LOG_COL = "nposOpsLog";

export type NposOpsLevel = "info" | "warn" | "error";

export type NposOpsEvent = {
  at: number;
  level: NposOpsLevel;
  cat: string;
  msg: string;
  detail: string;
  ok: boolean | null;
  vc: number;
  vn: string;
};

export type NposOpsLogDoc = {
  id: string;
  installId: string;
  updatedAt: number;
  versionCode: number;
  versionName: string;
  eventCount: number;
  lastLevel: NposOpsLevel | "";
  lastMsg: string;
  lastAt: number;
  events: NposOpsEvent[];
};

function mapLevel(raw: unknown): NposOpsLevel | "" {
  if (raw === "info" || raw === "warn" || raw === "error") return raw;
  return "";
}

function mapEvent(raw: Record<string, unknown>): NposOpsEvent {
  const level = mapLevel(raw.level) || "info";
  return {
    at: typeof raw.at === "number" ? raw.at : 0,
    level,
    cat: typeof raw.cat === "string" ? raw.cat : "app",
    msg: typeof raw.msg === "string" ? raw.msg : "—",
    detail: typeof raw.detail === "string" ? raw.detail : "",
    ok: raw.ok === true ? true : raw.ok === false ? false : null,
    vc: typeof raw.vc === "number" ? raw.vc : 0,
    vn: typeof raw.vn === "string" ? raw.vn : "",
  };
}

function mapDoc(id: string, data: Record<string, unknown>): NposOpsLogDoc {
  const eventsRaw = Array.isArray(data.events) ? data.events : [];
  const events = eventsRaw
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .map((e) => mapEvent(e))
    .sort((a, b) => b.at - a.at);

  return {
    id,
    installId: typeof data.installId === "string" ? data.installId : id,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
    versionCode: typeof data.versionCode === "number" ? data.versionCode : 0,
    versionName: typeof data.versionName === "string" ? data.versionName : "",
    eventCount: typeof data.eventCount === "number" ? data.eventCount : events.length,
    lastLevel: mapLevel(data.lastLevel),
    lastMsg: typeof data.lastMsg === "string" ? data.lastMsg : "",
    lastAt: typeof data.lastAt === "number" ? data.lastAt : 0,
    events,
  };
}

export function formatOpsAt(ts: number): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("th-TH");
  } catch {
    return String(ts);
  }
}

export function subscribeNposOpsLogs(
  onData: (docs: NposOpsLogDoc[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const q = query(collection(getDb(), NPOS_OPS_LOG_COL), orderBy("updatedAt", "desc"));
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => mapDoc(d.id, d.data() as Record<string, unknown>)));
    },
    (err) => onError(new Error(mapFirestoreError(err, "โหลดไทม์ไลน์ nPos", "pos"))),
  );
}
