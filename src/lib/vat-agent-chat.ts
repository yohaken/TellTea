/**
 * โต๊ะจูน (Tune Desk) — แชท local AI ↔ mentor/cloud
 * โปร่งใสบนเว็บ · มี timeout กันรอโดยไม่มีคนตอบ
 */
import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";


export const VAT_AGENT_CHAT_COL = "vatAgentChat";
export const VAT_AGENT_CHAT_PRESENCE_DOC = "vatAgentChatPresence";

/** ชื่อระบบ */
export const TUNE_DESK_NAME = "โต๊ะจูน";
export const TUNE_DESK_ID = "tune-desk";

export const DEFAULT_THREAD_ID = "vat-import";

/** รอ mentor สูงสุด (วินาที) — หมดแล้ว local ไปต่อเอง */
export const TUNE_DESK_DEFAULT_WAIT_SEC = 90;

export type TuneDeskRole = "local" | "mentor" | "owner" | "system";

export type TuneDeskMessage = {
  id: string;
  threadId: string;
  role: TuneDeskRole;
  name: string;
  body: string;
  createdAt: number;
  /** คำถามที่รอคำตอบ */
  isAsk: boolean;
  waitUntil: number | null;
  replyToId: string | null;
  clientMsgId: string;
};

export type TuneDeskPresence = {
  mentorOnline: boolean;
  mentorName: string;
  lastSeenAt: number;
};

const NAME_KEY = "telltea.tuneDesk.agentName";
const ROLE_KEY = "telltea.tuneDesk.uiRole";

export function loadStoredAgentName(): string {
  if (typeof window === "undefined") return "";
  return String(localStorage.getItem(NAME_KEY) || "").trim();
}

export function saveStoredAgentName(name: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(NAME_KEY, String(name || "").trim().slice(0, 40));
}

export function loadStoredUiRole(): "local" | "mentor" {
  if (typeof window === "undefined") return "local";
  return localStorage.getItem(ROLE_KEY) === "mentor" ? "mentor" : "local";
}

export function saveStoredUiRole(role: "local" | "mentor"): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(ROLE_KEY, role);
}

function mapMsg(id: string, raw: Record<string, unknown>): TuneDeskMessage {
  return {
    id,
    threadId: String(raw.threadId || DEFAULT_THREAD_ID),
    role: (["local", "mentor", "owner", "system"] as TuneDeskRole[]).includes(
      raw.role as TuneDeskRole,
    )
      ? (raw.role as TuneDeskRole)
      : "local",
    name: String(raw.name || "").trim() || "?",
    body: String(raw.body || "").trim(),
    createdAt: Number(raw.createdAt) || 0,
    isAsk: Boolean(raw.isAsk),
    waitUntil:
      typeof raw.waitUntil === "number" && Number.isFinite(raw.waitUntil)
        ? raw.waitUntil
        : null,
    replyToId: raw.replyToId ? String(raw.replyToId) : null,
    clientMsgId: String(raw.clientMsgId || ""),
  };
}

export function subscribeTuneDeskMessages(
  threadId: string,
  onNext: (msgs: TuneDeskMessage[]) => void,
  onError?: (e: Error) => void,
): Unsubscribe {
  // where อย่างเดียว — เรียงฝั่ง client เลี่ยง composite index
  const q = query(
    collection(getDb(), VAT_AGENT_CHAT_COL),
    where("threadId", "==", threadId || DEFAULT_THREAD_ID),
    limit(200),
  );
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => mapMsg(d.id, d.data() as Record<string, unknown>))
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
      onNext(list);
    },
    (e) => onError?.(e instanceof Error ? e : new Error(String(e))),
  );
}


export function subscribeTuneDeskPresence(
  onNext: (p: TuneDeskPresence) => void,
  onError?: (e: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(getDb(), "meta", VAT_AGENT_CHAT_PRESENCE_DOC),
    (snap) => {
      const raw = (snap.data() || {}) as Record<string, unknown>;
      const lastSeenAt = Number(raw.lastSeenAt) || 0;
      const mentorOnline =
        Boolean(raw.mentorOnline) && Date.now() - lastSeenAt < 45_000;
      onNext({
        mentorOnline,
        mentorName: String(raw.mentorName || "Mentor").trim() || "Mentor",
        lastSeenAt,
      });
    },
    (e) => onError?.(e instanceof Error ? e : new Error(String(e))),
  );
}

export async function heartbeatTuneDeskMentor(mentorName: string): Promise<void> {
  await setDoc(
    doc(getDb(), "meta", VAT_AGENT_CHAT_PRESENCE_DOC),
    {
      mentorOnline: true,
      mentorName: String(mentorName || "Mentor").trim().slice(0, 40),
      lastSeenAt: Date.now(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function clearTuneDeskMentorPresence(): Promise<void> {
  await setDoc(
    doc(getDb(), "meta", VAT_AGENT_CHAT_PRESENCE_DOC),
    {
      mentorOnline: false,
      lastSeenAt: Date.now(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function postTuneDeskMessage(input: {
  threadId?: string;
  role: TuneDeskRole;
  name: string;
  body: string;
  isAsk?: boolean;
  waitSec?: number;
  replyToId?: string | null;
  clientMsgId?: string;
}): Promise<string> {
  const body = String(input.body || "").trim().slice(0, 2000);
  if (!body) throw new Error("ข้อความว่าง");
  const name = String(input.name || "").trim().slice(0, 40) || "?";
  const now = Date.now();
  const isAsk = Boolean(input.isAsk) && input.role === "local";
  const waitSec = Math.min(
    300,
    Math.max(15, input.waitSec ?? TUNE_DESK_DEFAULT_WAIT_SEC),
  );
  const ref = await addDoc(collection(getDb(), VAT_AGENT_CHAT_COL), {
    threadId: input.threadId || DEFAULT_THREAD_ID,
    role: input.role,
    name,
    body,
    createdAt: now,
    isAsk,
    waitUntil: isAsk ? now + waitSec * 1000 : null,
    replyToId: input.replyToId || null,
    clientMsgId: input.clientMsgId || `${now}-${Math.random().toString(36).slice(2, 8)}`,
    system: TUNE_DESK_ID,
  });
  return ref.id;
}

/** ask หมดเวลายังไม่มี reply หลัง waitUntil หรือไม่ */
export function isAskTimedOut(
  ask: TuneDeskMessage,
  all: TuneDeskMessage[],
  now = Date.now(),
): boolean {
  if (!ask.isAsk || !ask.waitUntil) return false;
  if (now < ask.waitUntil) return false;
  const answered = all.some(
    (m) =>
      m.replyToId === ask.id &&
      (m.role === "mentor" || m.role === "owner") &&
      m.createdAt >= ask.createdAt,
  );
  return !answered;
}

export function askStillWaiting(
  ask: TuneDeskMessage,
  all: TuneDeskMessage[],
  now = Date.now(),
): boolean {
  if (!ask.isAsk || !ask.waitUntil) return false;
  if (now >= ask.waitUntil) return false;
  return !all.some(
    (m) =>
      m.replyToId === ask.id &&
      (m.role === "mentor" || m.role === "owner") &&
      m.createdAt >= ask.createdAt,
  );
}

/** คำสั่งสั้นฝังในระบบ — ให้ local AI อ่าน */
export const TUNE_DESK_PROTOCOL: string[] = [
  `「${TUNE_DESK_NAME}」ป๊อปอัป /vat-sales/ · ตั้งชื่อครั้งแรกแล้วใช้เดิม`,
  "พิมพ์สั้น · ถามเมื่อติดจริงเท่านั้น",
  `Ask รอไม่เกิน ${TUNE_DESK_DEFAULT_WAIT_SEC}s · mentor ออฟไลน์/หมดเวลา → ไปต่อ`,
  "อ่าน #vat-import-ai-notes · ผสานเดือนอัตโนมัติแล้ว",
];
