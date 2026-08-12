/**
 * ตั้งค่าแจ้งเตือนเจ้าของ — LINE ส่วนตัว + สรุปรายวันเช้า
 * เก็บใน meta/ownerLineNotify (owner-only · มี token)
 */
import { doc, getDoc, setDoc } from "firebase/firestore";
import { getDb } from "./firebase";

export type OwnerNotifySettings = {
  /** LINE Messaging API long-lived channel access token */
  channelAccessToken: string;
  /** LINE userId ของเจ้าของ (U…) */
  lineUserId: string;
  /** ส่งสรุปรายวันทาง LINE */
  dailyDigestEnabled: boolean;
  /** ชั่วโมง Asia/Bangkok 0–23 (ค่าเริ่ม 8) */
  digestHour: number;
  includeLowBalance: boolean;
  includeBillNotices: boolean;
  includeYesterdaySales: boolean;
  includeMemberCount: boolean;
  /** ส่ง Web Push คู่กับ LINE ด้วย */
  webPushOnDigest: boolean;
  updatedAt: number;
  updatedBy: string;
};

export const DEFAULT_OWNER_NOTIFY: OwnerNotifySettings = {
  channelAccessToken: "",
  lineUserId: "",
  dailyDigestEnabled: true,
  digestHour: 8,
  includeLowBalance: true,
  includeBillNotices: true,
  includeYesterdaySales: true,
  includeMemberCount: true,
  webPushOnDigest: true,
  updatedAt: 0,
  updatedBy: "",
};

function ownerNotifyRef() {
  return doc(getDb(), "meta", "ownerLineNotify");
}

function clampHour(n: unknown): number {
  const h = Math.round(Number(n));
  if (!Number.isFinite(h)) return 8;
  return Math.min(23, Math.max(0, h));
}

export function parseOwnerNotifySettings(
  data: Partial<OwnerNotifySettings> | undefined,
): OwnerNotifySettings {
  if (!data) return { ...DEFAULT_OWNER_NOTIFY };
  return {
    channelAccessToken: String(data.channelAccessToken || "").trim(),
    lineUserId: String(data.lineUserId || "").trim(),
    dailyDigestEnabled: data.dailyDigestEnabled !== false,
    digestHour: clampHour(data.digestHour),
    includeLowBalance: data.includeLowBalance !== false,
    includeBillNotices: data.includeBillNotices !== false,
    includeYesterdaySales: data.includeYesterdaySales !== false,
    includeMemberCount: data.includeMemberCount !== false,
    webPushOnDigest: data.webPushOnDigest !== false,
    updatedAt: Number(data.updatedAt) || 0,
    updatedBy: String(data.updatedBy || ""),
  };
}

export async function getOwnerNotifySettings(): Promise<OwnerNotifySettings> {
  const snap = await getDoc(ownerNotifyRef());
  if (!snap.exists()) return { ...DEFAULT_OWNER_NOTIFY };
  return parseOwnerNotifySettings(snap.data() as Partial<OwnerNotifySettings>);
}

export type OwnerNotifySaveInput = {
  channelAccessToken: string;
  lineUserId: string;
  dailyDigestEnabled: boolean;
  digestHour: number;
  includeLowBalance: boolean;
  includeBillNotices: boolean;
  includeYesterdaySales: boolean;
  includeMemberCount: boolean;
  webPushOnDigest: boolean;
};

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
      dailyDigestEnabled: next.dailyDigestEnabled,
      digestHour: next.digestHour,
      includeLowBalance: next.includeLowBalance,
      includeBillNotices: next.includeBillNotices,
      includeYesterdaySales: next.includeYesterdaySales,
      includeMemberCount: next.includeMemberCount,
      webPushOnDigest: next.webPushOnDigest,
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
