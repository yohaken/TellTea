import { getFirebaseAuth } from "./firebase";
import {
  claimBlockedTitle,
  claimErrorLabel,
  type ReceiptClaimAuthLookup,
  type ReceiptClaimResult,
} from "./receipt-claim";

export { claimBlockedTitle, claimErrorLabel };

export const PUBLIC_COMP_COUPON_PREVIEW_URL =
  "https://asia-southeast1-mypeer-501909.cloudfunctions.net/publicCompCouponPreview";

export const PUBLIC_COMP_COUPON_LOOKUP_URL =
  "https://asia-southeast1-mypeer-501909.cloudfunctions.net/publicCompCouponLookup";

export const PUBLIC_COMP_COUPON_CLAIM_URL =
  "https://asia-southeast1-mypeer-501909.cloudfunctions.net/publicCompCouponClaim";

export type CompCouponPreview = {
  ok: boolean;
  error?: string;
  pointsPreview?: number;
  expiresAt?: number;
};

async function currentIdToken(): Promise<string> {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new Error("ต้องเข้าสู่ระบบก่อน");
  return user.getIdToken(true);
}

export async function fetchCompCouponPreview(token: string): Promise<CompCouponPreview> {
  const res = await fetch(PUBLIC_COMP_COUPON_PREVIEW_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  return (await res.json()) as CompCouponPreview;
}

export async function lookupCompCouponAuth(token: string): Promise<ReceiptClaimAuthLookup> {
  const idToken = await currentIdToken();
  const res = await fetch(PUBLIC_COMP_COUPON_LOOKUP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, idToken }),
  });
  return (await res.json()) as ReceiptClaimAuthLookup;
}

export async function submitCompCouponClaim(input: {
  token: string;
  phone?: string;
  displayName?: string;
  pdpaAccepted?: boolean;
}): Promise<ReceiptClaimResult> {
  const idToken = await currentIdToken();
  const res = await fetch(PUBLIC_COMP_COUPON_CLAIM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: input.token,
      phone: input.phone || "",
      displayName: input.displayName || "",
      pdpaAccepted: input.pdpaAccepted === true,
      idToken,
    }),
  });
  return (await res.json()) as ReceiptClaimResult;
}

export function giftErrorLabel(code: string | undefined): string {
  const map: Record<string, string> = {
    comp_off: "ร้านยังไม่เปิด QR ให้แต้ม",
    quota_exhausted: "โควต้าวันนี้หมดแล้ว",
    quota_zero: "ยังไม่ได้ตั้งโควต้า",
  };
  const key = (code || "").trim();
  if (map[key]) return map[key];
  return claimErrorLabel(code);
}

export function giftBlockedTitle(code: string | undefined): string {
  switch ((code || "").trim()) {
    case "comp_off":
      return "ร้านยังไม่เปิดรับแต้มจาก QR นี้";
    case "expired":
      return "ลิงก์นี้หมดอายุแล้ว";
    case "bad_token":
      return "ไม่เจอ QR นี้";
    default:
      return claimBlockedTitle(code);
  }
}
