/**
 * ตั้งค่าแจ้งเตือนเจ้าของ → LINE โดยเฉพาะ
 * เก็บใน meta/ownerLineNotify (owner-only · มี token)
 */
import { doc, getDoc, setDoc } from "firebase/firestore";
import { getDb } from "./firebase";

export type OwnerNotifySettings = {
  /** LINE Messaging API long-lived channel access token */
  channelAccessToken: string;
  /** LINE userId ของเจ้าของ (U…) */
  lineUserId: string;
  /** ส่วนที่ 1: แจ้งทันทีเมื่อเข้าเงื่อนไข (เช่น ยอดต่ำ) → LINE */
  instantLineEnabled: boolean;
  /** ชั่วโมงเริ่มส่งแจ้งทันที (Asia/Bangkok 0–23) */
  instantHourStart: number;
  /** ชั่วโมงสิ้นสุดส่งแจ้งทันที (รวมชั่วโมงนี้) */
  instantHourEnd: number;
  /** ส่วนที่ 2: สรุปรายวันทาง LINE */
  dailyDigestEnabled: boolean;
  digestHour: number;
  includeLowBalance: boolean;
  includeBillNotices: boolean;
  includeYesterdaySales: boolean;
  includeMemberCount: boolean;
  /** ช่องทางสำรอง (ปิดเป็นค่าเริ่ม — หลักคือ LINE) */
  webPushOnDigest: boolean;
  webPushOnInstant: boolean;
  updatedAt: number;
  updatedBy: string;
};

export const DEFAULT_OWNER_NOTIFY: OwnerNotifySettings = {
  channelAccessToken: "",
  lineUserId: "",
  instantLineEnabled: true,
  instantHourStart: 8,
  instantHourEnd: 21,
  dailyDigestEnabled: true,
  digestHour: 8,
  includeLowBalance: true,
  includeBillNotices: true,
  includeYesterdaySales: true,
  includeMemberCount: true,
  webPushOnDigest: false,
  webPushOnInstant: false,
  updatedAt: 0,
  updatedBy: "",
};

function ownerNotifyRef() {
  return doc(getDb(), "meta", "ownerLineNotify");
}

function clampHour(n: unknown, fallback = 8): number {
  const h = Math.round(Number(n));
  if (!Number.isFinite(h)) return fallback;
  return Math.min(23, Math.max(0, h));
}

export function parseOwnerNotifySettings(
  data: Partial<OwnerNotifySettings> | undefined,
): OwnerNotifySettings {
  if (!data) return { ...DEFAULT_OWNER_NOTIFY };
  return {
    channelAccessToken: String(data.channelAccessToken || "").trim(),
    lineUserId: String(data.lineUserId || "").trim(),
    instantLineEnabled: data.instantLineEnabled !== false,
    instantHourStart: clampHour(data.instantHourStart, 8),
    instantHourEnd: clampHour(data.instantHourEnd, 21),
    dailyDigestEnabled: data.dailyDigestEnabled !== false,
    digestHour: clampHour(data.digestHour, 8),
    includeLowBalance: data.includeLowBalance !== false,
    includeBillNotices: data.includeBillNotices !== false,
    includeYesterdaySales: data.includeYesterdaySales !== false,
    includeMemberCount: data.includeMemberCount !== false,
    webPushOnDigest: data.webPushOnDigest === true,
    webPushOnInstant: data.webPushOnInstant === true,
    updatedAt: Number(data.updatedAt) || 0,
    updatedBy: String(data.updatedBy || ""),
  };
}

export async function getOwnerNotifySettings(): Promise<OwnerNotifySettings> {
  const snap = await getDoc(ownerNotifyRef());
  if (!snap.exists()) return { ...DEFAULT_OWNER_NOTIFY };
  return parseOwnerNotifySettings(snap.data() as Partial<OwnerNotifySettings>);
}

export type OwnerNotifySaveInput = Omit<
  OwnerNotifySettings,
  "updatedAt" | "updatedBy"
>;

export async function saveOwnerNotifySettings(
  input: OwnerNotifySaveInput,
  actorId: string,
): Promise<void> {
  const token = String(input.channelAccessToken || "").trim();
  const userId = String(input.lineUserId || "").trim();
  if (userId && !/^U[0-9a-f]{32}$/i.test(userId)) {
    throw new Error("LINE User ID ไม่ถูกต้อง (ต้องขึ้นต้นด้วย U ตามด้วยตัวอักษร 32 ตัว)");
  }
  const next = parseOwnerNotifySettings({
    ...input,
    channelAccessToken: token,
    lineUserId: userId,
    updatedAt: Date.now(),
    updatedBy: actorId || "owner",
  });
  await setDoc(
    ownerNotifyRef(),
    {
      channelAccessToken: next.channelAccessToken,
      lineUserId: next.lineUserId,
      instantLineEnabled: next.instantLineEnabled,
      instantHourStart: next.instantHourStart,
      instantHourEnd: next.instantHourEnd,
      dailyDigestEnabled: next.dailyDigestEnabled,
      digestHour: next.digestHour,
      includeLowBalance: next.includeLowBalance,
      includeBillNotices: next.includeBillNotices,
      includeYesterdaySales: next.includeYesterdaySales,
      includeMemberCount: next.includeMemberCount,
      webPushOnDigest: next.webPushOnDigest,
      webPushOnInstant: next.webPushOnInstant,
      updatedAt: next.updatedAt,
      updatedBy: next.updatedBy,
    },
    { merge: true },
  );
}

/** แสดง token แบบปิดบังใน UI */
export function maskSecret(value: string): string {
  const s = String(value || "").trim();
  if (!s) return "";
  if (s.length <= 8) return "••••••••";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

export function lineReady(settings: OwnerNotifySettings): boolean {
  return Boolean(settings.channelAccessToken && settings.lineUserId);
}

export function formatHourLabel(hour: number): string {
  return `${String(clampHour(hour, 0)).padStart(2, "0")}:00`;
}
