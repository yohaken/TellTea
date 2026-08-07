import QRCode from "qrcode";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { getDb, getFirebaseAuth } from "./firebase";
import { getMemberSettings, pointsFromReceiptClaim } from "./members";
import { POS_SALES_COL } from "./pos-sales";

export const PUBLIC_RECEIPT_CLAIM_PREVIEW_URL =
  "https://asia-southeast1-mypeer-501909.cloudfunctions.net/publicReceiptClaimPreview";

export const PUBLIC_RECEIPT_CLAIM_LOOKUP_URL =
  "https://asia-southeast1-mypeer-501909.cloudfunctions.net/publicReceiptClaimLookup";

export const PUBLIC_RECEIPT_CLAIM_URL =
  "https://asia-southeast1-mypeer-501909.cloudfunctions.net/publicReceiptClaim";

export type ReceiptClaimIssue = {
  saleId: string;
  billNo: string;
  total: number;
  pointsPreview: number;
  token: string;
  expiresAt: number;
  claimUrl: string;
  reused: boolean;
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

/** ออก/ต่ออายุ claimToken บนบิล — เจ้าของเขียน posSales โดยตรง (ไม่แตะ path ปิดบิล) */
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
  if (d.claimStatus === "claimed") throw new Error("บิลนี้เคลมแต้มไปแล้ว");

  const total = typeof d.total === "number" ? d.total : 0;
  const billNo = typeof d.billNo === "string" ? d.billNo : id;
  const pointsPreview = pointsFromReceiptClaim(total, settings);
  if (pointsPreview <= 0) {
    throw new Error("ยอดบิลนี้ยังคิดแต้มไม่ได้ (ตรวจ % สะสม / ยอดสุทธิ)");
  }

  const now = Date.now();
  const ttlMs = Math.max(1, settings.claimTokenTtlDays) * 24 * 60 * 60 * 1000;
  const existingToken = typeof d.claimToken === "string" ? d.claimToken.trim() : "";
  const existingExp =
    typeof d.claimTokenExpiresAt === "number" ? d.claimTokenExpiresAt : 0;
  const canReuse =
    !opts?.forceNewToken &&
    existingToken.length >= 16 &&
    existingExp > now + 60_000;

  const token = canReuse ? existingToken : randomToken();
  const expiresAt = canReuse ? existingExp : now + ttlMs;

  await updateDoc(ref, {
    claimToken: token,
    claimTokenExpiresAt: expiresAt,
    claimIssuedAt: now,
    claimIssuedBy: actorId || "owner",
    claimStatus: "open",
  });

  return {
    saleId: id,
    billNo,
    total,
    pointsPreview,
    token,
    expiresAt,
    claimUrl: buildClaimUrl(id, token),
    reused: canReuse,
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
  alreadyMemberHint?: boolean;
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

export type ReceiptClaimLookup = {
  ok: boolean;
  error?: string;
  found?: boolean;
  phoneDisplay?: string;
  billNo?: string;
  total?: number;
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

export async function lookupReceiptClaimMember(input: {
  saleId: string;
  token: string;
  phone: string;
}): Promise<ReceiptClaimLookup> {
  const res = await fetch(PUBLIC_RECEIPT_CLAIM_LOOKUP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      saleId: input.saleId,
      token: input.token,
      phone: input.phone,
    }),
  });
  return (await res.json()) as ReceiptClaimLookup;
}

/** สมาชิกเดิม — ใส่เบอร์แล้วยืนยัน โดยไม่ OTP */
export async function submitExistingReceiptClaim(input: {
  saleId: string;
  token: string;
  phone: string;
}): Promise<ReceiptClaimResult> {
  const res = await fetch(PUBLIC_RECEIPT_CLAIM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      saleId: input.saleId,
      token: input.token,
      phone: input.phone,
      confirmExisting: true,
    }),
  });
  return (await res.json()) as ReceiptClaimResult;
}

/** สมัครใหม่ + เคลม — ช่วงทดลองไม่บังคับ OTP (ส่ง phone + PDPA) */
export async function submitReceiptClaim(input: {
  saleId: string;
  token: string;
  phone?: string;
  displayName?: string;
  pdpaAccepted: boolean;
}): Promise<ReceiptClaimResult> {
  const body: Record<string, unknown> = {
    saleId: input.saleId,
    token: input.token,
    phone: input.phone || "",
    displayName: input.displayName || "",
    pdpaAccepted: input.pdpaAccepted === true,
  };
  // Optional OTP if already signed in — not required for experiment
  try {
    const user = getFirebaseAuth().currentUser;
    if (user) body.idToken = await user.getIdToken();
  } catch {
    /* ignore */
  }
  const res = await fetch(PUBLIC_RECEIPT_CLAIM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as ReceiptClaimResult;
}

export function claimErrorLabel(code: string | undefined): string {
  const map: Record<string, string> = {
    disabled: "ระบบสมาชิกปิดอยู่",
    receipt_off: "โหมดทดลองเคลมจากสลิปยังปิดอยู่",
    bad_token: "ลิงก์หมดอายุหรือไม่ถูกต้อง",
    expired: "ลิงก์เคลมหมดอายุแล้ว — ขอ QR ใหม่จากร้าน",
    voided: "บิลนี้ยกเลิกแล้ว เคลมไม่ได้",
    already_claimed: "บิลนี้เคลมแต้มไปแล้ว",
    already_earned: "บิลนี้สะสมแต้มไปแล้ว",
    invalid_phone: "เบอร์โทรไม่ถูกต้อง",
    not_member: "ยังไม่เป็นสมาชิก — กดสมัครก่อน",
    auth_required: "ต้องยืนยันตัวตนก่อน",
    auth_mismatch: "เบอร์ที่ยืนยัน OTP ไม่ตรง",
    pdpa_required: "ต้องยินยอมนโยบายข้อมูลส่วนบุคคล",
    suspended: "บัตรสมาชิกระงับ",
    zero_points: "บิลนี้ยังไม่มีแต้มให้เคลม",
    missing_sale: "ไม่พบบิล",
    bad_body: "ข้อมูลไม่ครบ",
  };
  return map[code || ""] || code || "ทำรายการไม่สำเร็จ";
}
