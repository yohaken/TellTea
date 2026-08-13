/**
 * เครดิตแต้มจากเกมลุ้น — เรียก Cloud Function (ไม่เชื่อ client balance)
 */
import { getFirebaseAuth } from "@/lib/firebase";
import type { PointsGameId } from "@/lib/points-games";

export const PUBLIC_SPIN_GAME_CREDIT_URL =
  "https://asia-southeast1-mypeer-501909.cloudfunctions.net/publicSpinGameCredit";

export type SpinGameCreditResult = {
  ok: boolean;
  error?: string;
  points?: number;
  balanceAfter?: number;
  lifetimeGameBonusPoints?: number;
  skipped?: string;
};

export async function creditSpinGamePoints(input: {
  gameId?: PointsGameId;
  points: number;
  context: "claim" | "join";
  /** บิลเคลม — ใช้กับ context=claim */
  contextId?: string;
  /** ตั๋วจากสมัครสมาชิก — ใช้กับ context=join */
  playToken?: string;
}): Promise<SpinGameCreditResult> {
  const points = Math.trunc(Number(input.points) || 0);
  if (points < 1 || points > 5) {
    return { ok: false, error: "bad_points" };
  }
  const body: Record<string, unknown> = {
    gameId: input.gameId || "spin",
    points,
    context: input.context,
  };
  if (input.contextId) body.contextId = input.contextId;
  if (input.playToken) body.playToken = input.playToken;

  if (input.context === "claim") {
    const user = getFirebaseAuth().currentUser;
    if (!user) return { ok: false, error: "auth_required" };
    body.idToken = await user.getIdToken();
  }

  try {
    const res = await fetch(PUBLIC_SPIN_GAME_CREDIT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as SpinGameCreditResult;
    if (!res.ok && !data.error) {
      return { ok: false, error: "credit_failed" };
    }
    return data;
  } catch {
    return { ok: false, error: "network" };
  }
}

export function spinCreditErrorLabel(code?: string): string {
  const map: Record<string, string> = {
    game_off: "ร้านปิดเกมลุ้นแต้มชั่วคราว",
    bad_points: "ผลเกมไม่ถูกต้อง",
    auth_required: "เข้าสู่ระบบก่อนนะ",
    not_member: "ยังไม่เจอสมาชิก",
    already_played: "หมุนรอบนี้ไปแล้ว",
    bad_play: "ลิงก์หมุนหมดอายุ",
    bad_claim: "บิลนี้หมุนไม่ได้",
    credit_failed: "บันทึกแต้มไม่สำเร็จ ลองใหม่",
    network: "เชื่อมต่อไม่ได้ ลองใหม่",
  };
  return map[code || ""] || code || "บันทึกแต้มไม่สำเร็จ";
}
