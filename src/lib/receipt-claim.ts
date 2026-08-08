import QRCode from "qrcode";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import {
  GoogleAuthProvider,
  signInWithPopup,
  type User,
} from "firebase/auth";
import {
  mapFirebaseAuthError,
  shouldUseGoogleAuthBridge,
  startGoogleAuthBridge,
} from "./auth";
import { getDb, getFirebaseAuth } from "./firebase";
import { getMemberSettings, pointsFromReceiptClaim } from "./members";
import { POS_SALES_COL } from "./pos-sales";

export const PUBLIC_RECEIPT_CLAIM_PREVIEW_URL =
  "https://asia-southeast1-mypeer-501909.cloudfunctions.net/publicReceiptClaimPreview";

export const PUBLIC_RECEIPT_CLAIM_LOOKUP_URL =
  "https://asia-southeast1-mypeer-501909.cloudfunctions.net/publicReceiptClaimLookup";

export const PUBLIC_RECEIPT_CLAIM_URL =
  "https://asia-southeast1-mypeer-501909.cloudfunctions.net/publicReceiptClaim";

export const PUBLIC_MEMBER_ME_URL =
  "https://asia-southeast1-mypeer-501909.cloudfunctions.net/publicMemberMe";

export type ReceiptClaimIssue = {
  saleId: string;
  billNo: string;
  total: number;
  pointsPreview: number;
  token: string;
  expiresAt: number;
  claimUrl: string;
  reused: boolean;
  /** บิลเคลมแล้ว — โชว์ QR/ลิงก์เดิมเพื่อเทสหน้า «ใช้แล้ว» */
  claimed: boolean;
};

function randomToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return `tt${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export function buildClaimPath(saleId: string, token: string): string {
  const s = encodeURIComponent(saleId);
  const t = encodeURIComponent(token);
  return `/claim/?s=${s}&t=${t}`;
}

export function buildClaimUrl(saleId: string, token: string, origin?: string): string {
  const path = buildClaimPath(saleId, token);
  if (origin) return `${origin.replace(/\/$/, "")}${path}`;
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}${path}`;
  }
  return `https://telltea-shop.web.app${path}`;
}

export async function claimQrDataUrl(claimUrl: string): Promise<string> {
  return QRCode.toDataURL(claimUrl, {
    margin: 1,
    width: 280,
    errorCorrectionLevel: "M",
  });
}

/**
 * ออก/โชว์ claimToken บนบิล — เจ้าของเขียน posSales โดยตรง
 * - ปกติ: จำโทเคนเดิมถ้ายังไม่หมดอายุ (รวมบิลที่เคลมแล้ว → โชว์ QR เดิม)
 * - forceNewToken: เจนโทเคนใหม่จาก saleId เดิม (เทส) · บิลที่เคลมแล้วยังคง claimed
 */
export async function issueReceiptClaimForSale(
  saleId: string,
  actorId: string,
  opts?: { forceNewToken?: boolean },
): Promise<ReceiptClaimIssue> {
  const id = String(saleId || "").trim();
  if (!id) throw new Error("ระบุรหัสบิล");
  const settings = await getMemberSettings();
  if (!settings.enabled) throw new Error("ระบบสมาชิกปิดอยู่ — เปิดที่แท็บตั้งค่าก่อน");
  if (!settings.receiptClaimEnabled) {
    throw new Error("โหมดทดลองเคลมจากสลิปยังปิดอยู่");
  }

  const ref = doc(getDb(), POS_SALES_COL, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("ไม่พบบิลนี้");
  const d = snap.data() as Record<string, unknown>;
  if (d.status === "voided") throw new Error("บิลนี้ยกเลิกแล้ว — ออก QR ไม่ได้");

  const total = typeof d.total === "number" ? d.total : 0;
  const billNo = typeof d.billNo === "string" ? d.billNo : id;
  const claimed = d.claimStatus === "claimed";
  // A1: ออก QR ได้แม้ 0 แต้ม — สแกนแล้วไปหน้าสมาชิก
  const pointsPreview = pointsFromReceiptClaim(total, settings);

  const now = Date.now();
  const ttlMs = Math.max(1, settings.claimTokenTtlDays) * 24 * 60 * 60 * 1000;
  const existingToken = typeof d.claimToken === "string" ? d.claimToken.trim() : "";
  const existingExp =
    typeof d.claimTokenExpiresAt === "number" ? d.claimTokenExpiresAt : 0;

  // บิลเคลมแล้ว + ไม่บังคับโทเคนใหม่ → โชว์ QR/ลิงก์เดิม (ไม่เขียนทับสถานะ)
  if (claimed && !opts?.forceNewToken) {
    if (existingToken.length < 16) {
      throw new Error("บิลเคลมแล้ว แต่ไม่มีโทเคนเดิม — กด «โทเคนใหม่ (เทส)» ได้");
    }
    return {
      saleId: id,
      billNo,
      total,
      pointsPreview,
      token: existingToken,
      expiresAt: existingExp || now + ttlMs,
      claimUrl: buildClaimUrl(id, existingToken),
      reused: true,
      claimed: true,
    };
  }

  const canReuse =
    !opts?.forceNewToken &&
    !claimed &&
    existingToken.length >= 16 &&
    existingExp > now + 60_000;

  const token = canReuse ? existingToken : randomToken();
  const expiresAt = canReuse ? existingExp : now + ttlMs;

  const patch: Record<string, unknown> = {
    claimToken: token,
    claimTokenExpiresAt: expiresAt,
    claimIssuedAt: now,
    claimIssuedBy: actorId || "owner",
  };
  // บิลที่ยังไม่เคลม → คง/เปิดสถานะ open · บิลเคลมแล้ว + โทเคนใหม่ → คง claimed
  if (!claimed) {
    patch.claimStatus = "open";
  }

  await updateDoc(ref, patch);

  return {
    saleId: id,
    billNo,
    total,
    pointsPreview,
    token,
    expiresAt,
    claimUrl: buildClaimUrl(id, token),
    reused: canReuse,
    claimed,
  };
}

export type ReceiptClaimPreview = {
  ok: boolean;
  error?: string;
  billNo?: string;
  total?: number;
  pointsPreview?: number;
  bahtPerPoint?: number;
  expiresAt?: number;
  claimStatus?: string;
};

export async function fetchReceiptClaimPreview(
  saleId: string,
  token: string,
): Promise<ReceiptClaimPreview> {
  const res = await fetch(PUBLIC_RECEIPT_CLAIM_PREVIEW_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ saleId, token }),
  });
  return (await res.json()) as ReceiptClaimPreview;
}

export type ReceiptClaimAuthLookup = {
  ok: boolean;
  error?: string;
  found?: boolean;
  needsPhone?: boolean;
  provider?: string;
  email?: string;
  pointsPreview?: number;
  member?: {
    id?: string;
    displayName?: string;
    cardNo?: string;
    pointsBalance?: number;
  };
};

export type ReceiptClaimResult = {
  ok: boolean;
  error?: string;
  points?: number;
  balanceAfter?: number;
  member?: {
    id?: string;
    displayName?: string;
    cardNo?: string;
    pointsBalance?: number;
    isNew?: boolean;
  };
};

export type MemberMeResult = {
  ok: boolean;
  error?: string;
  found?: boolean;
  member?: {
    id?: string;
    displayName?: string;
    cardNo?: string;
    phoneDisplay?: string;
    pointsBalance?: number;
    lifetimePointsEarned?: number;
    email?: string;
  };
};

async function currentIdToken(): Promise<string> {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new Error("ต้องเข้าสู่ระบบก่อน");
  return user.getIdToken(true);
}

/**
 * Google for /claim and /me.
 * On production hosts: redirect through firebaseapp auth bridge (popup fails in LINE/WebView
 * with auth/argument-error). Returns null when navigating away.
 */
function memberGoogleReturnUrl(): string {
  if (typeof window === "undefined") return "https://telltea-shop.web.app/me/";
  const url = new URL(window.location.href);
  url.hash = "";
  url.searchParams.delete("ticket");
  return url.toString();
}

export async function signInMemberWithGoogle(): Promise<User | null> {
  if (shouldUseGoogleAuthBridge()) {
    startGoogleAuthBridge(memberGoogleReturnUrl());
    return null;
  }
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    const cred = await signInWithPopup(getFirebaseAuth(), provider);
    return cred.user;
  } catch (err) {
    throw new Error(mapFirebaseAuthError(err));
  }
}

export async function lookupReceiptClaimAuth(input: {
  saleId: string;
  token: string;
}): Promise<ReceiptClaimAuthLookup> {
  const idToken = await currentIdToken();
  const res = await fetch(PUBLIC_RECEIPT_CLAIM_LOOKUP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      saleId: input.saleId,
      token: input.token,
      idToken,
    }),
  });
  return (await res.json()) as ReceiptClaimAuthLookup;
}

export async function submitReceiptClaim(input: {
  saleId: string;
  token: string;
  phone?: string;
  displayName?: string;
  pdpaAccepted?: boolean;
}): Promise<ReceiptClaimResult> {
  const idToken = await currentIdToken();
  const res = await fetch(PUBLIC_RECEIPT_CLAIM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      saleId: input.saleId,
      token: input.token,
      phone: input.phone || "",
      displayName: input.displayName || "",
      pdpaAccepted: input.pdpaAccepted === true,
      idToken,
    }),
  });
  return (await res.json()) as ReceiptClaimResult;
}

export async function fetchMemberMe(): Promise<MemberMeResult> {
  const idToken = await currentIdToken();
  const res = await fetch(PUBLIC_MEMBER_ME_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  return (await res.json()) as MemberMeResult;
}

export function claimErrorLabel(code: string | undefined): string {
  const map: Record<string, string> = {
    disabled: "ยังเปิดสะสมแต้มไม่ได้ตอนนี้",
    receipt_off: "ยังเปิดรับแต้มจากสลิปไม่ได้",
    bad_token: "ลิงก์ใช้ไม่ได้แล้ว สแกนจากสลิปใหม่นะ",
    expired: "ลิงก์หมดอายุแล้ว ขอบิลใหม่ที่ร้านนะ",
    voided: "บิลนี้ยกเลิกแล้ว รับแต้มไม่ได้",
    already_claimed: "ได้แต้มจากบิลนี้ไปแล้ว",
    already_earned: "ได้แต้มจากบิลนี้ไปแล้ว",
    invalid_phone: "เบอร์นี้ใช้ไม่ได้",
    phone_required: "ใส่เบอร์ก่อนนะ",
    phone_otp_required: "ยืนยันเบอร์ด้วยรหัสก่อนนะ",
    phone_mismatch: "เบอร์ไม่ตรงกับที่รับรหัส",
    not_member: "ยังไม่เจอสมาชิก",
    auth_required: "เข้าด้วย Google หรือเบอร์ก่อนนะ",
    auth_mismatch: "บัญชีไม่ตรง",
    pdpa_required: "กดยอมรับก่อนนะ",
    suspended: "บัตรนี้ใช้ไม่ได้ชั่วคราว",
    zero_points: "บิลนี้ยังไม่มีแต้ม",
    missing_sale: "ไม่เจอบิลนี้",
    bad_body: "ข้อมูลไม่ครบ",
  };
  const key = (code || "").trim();
  if (map[key]) return map[key];
  if (/Firebase:\s*Error|auth\/[a-z0-9-]+/i.test(key)) {
    return "เข้าสู่ระบบไม่สำเร็จ — ลองใหม่ หรือใช้เบอร์แทน";
  }
  return key || "ลองใหม่อีกครั้งนะ";
}

/** Soft title for blocked claim states — never sounds like “สมัครไม่ได้”. */
export function claimBlockedTitle(code: string | undefined): string {
  switch ((code || "").trim()) {
    case "expired":
      return "ลิงก์บิลนี้หมดอายุแล้ว";
    case "bad_token":
    case "missing_sale":
      return "ไม่เจอบิลจากลิงก์นี้";
    case "voided":
      return "บิลนี้ยกเลิกแล้ว";
    case "disabled":
    case "receipt_off":
      return "ร้านยังไม่เปิดรับแต้มจากสลิป";
    default:
      return "เปิดบิลนี้ไม่สำเร็จ";
  }
}
