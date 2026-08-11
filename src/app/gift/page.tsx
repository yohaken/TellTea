"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ConfirmationResult } from "firebase/auth";
import {
  confirmPhoneOtp,
  currentAuthHasVerifiedPhone,
  resetPhoneRecaptcha,
  sendLinkPhoneOtp,
  sendPhoneOtp,
} from "@/lib/phone-auth";
import { ClaimPointsValueNote } from "@/components/ClaimPointsValueNote";
import {
  completeMemberGoogleRedirect,
  mapFirebaseAuthError,
  signInMemberWithGoogle,
} from "@/lib/member-auth";
import {
  fetchCompCouponPreview,
  giftBlockedTitle,
  giftErrorLabel,
  lookupCompCouponAuth,
  submitCompCouponClaim,
} from "@/lib/comp-coupon";
import type { ReceiptClaimAuthLookup } from "@/lib/receipt-claim";

type Step =
  | "load"
  | "auth"
  | "otp"
  | "link_phone"
  | "confirm"
  | "done"
  | "used"
  | "blocked";

function isAlreadyUsedError(code: string | undefined): boolean {
  return code === "already_claimed" || code === "already_earned";
}

function GiftForm() {
  const params = useSearchParams();
  const token = useMemo(() => (params.get("c") || params.get("token") || "").trim(), [params]);

  const [step, setStep] = useState<Step>("load");
  const [pointsPreview, setPointsPreview] = useState<number | null>(null);
  const [authInfo, setAuthInfo] = useState<ReceiptClaimAuthLookup | null>(null);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [pdpa, setPdpa] = useState(false);
  const [otp, setOtp] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPhoneAlt, setShowPhoneAlt] = useState(true);
  const [otpPurpose, setOtpPurpose] = useState<"auth" | "link_claim">("auth");
  const [popupOpen, setPopupOpen] = useState(false);
  const [blockedCode, setBlockedCode] = useState<string | undefined>(undefined);
  const [done, setDone] = useState<{
    displayName: string;
    cardNo: string;
    points: number;
    balance: number;
    isNew: boolean;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!token) {
        setStep("blocked");
        setBlockedCode("bad_token");
        setError("ลิงก์ไม่ครบ สแกน QR จากสลิปอีกครั้งนะ");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        try {
          const redirected = await completeMemberGoogleRedirect();
          if (cancelled) return;
          if (redirected) {
            const data = await fetchCompCouponPreview(token);
            if (cancelled) return;
            if (!data.ok) {
              if (isAlreadyUsedError(data.error)) {
                setStep("used");
                setError(null);
                return;
              }
              setStep("blocked");
              setBlockedCode(data.error);
              setError(giftErrorLabel(data.error));
              return;
            }
            setPointsPreview(
              typeof data.pointsPreview === "number" ? data.pointsPreview : 1,
            );
            setStep("auth");
            setBusy(true);
            const info = await lookupCompCouponAuth(token);
            if (cancelled) return;
            setAuthInfo(info);
            if (!info.ok) {
              if (isAlreadyUsedError(info.error)) {
                setStep("used");
                setError(null);
                return;
              }
              setError(giftErrorLabel(info.error));
              return;
            }
            if (info.found) {
              setStep("confirm");
              return;
            }
            setStep("link_phone");
            return;
          }
        } catch (err) {
          if (!cancelled) {
            setError(mapFirebaseAuthError(err));
            setStep("auth");
          }
        }

        const data = await fetchCompCouponPreview(token);
        if (cancelled) return;
        if (!data.ok) {
          if (isAlreadyUsedError(data.error)) {
            setStep("used");
            setError(null);
            return;
          }
          setStep("blocked");
          setBlockedCode(data.error);
          setError(giftErrorLabel(data.error));
          return;
        }
        setPointsPreview(typeof data.pointsPreview === "number" ? data.pointsPreview : 1);
        setStep("auth");
      } catch {
        if (!cancelled) {
          setStep("blocked");
          setBlockedCode(undefined);
          setError("เน็ตหลุด ลองใหม่นะ");
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
      resetPhoneRecaptcha();
    };
  }, [token]);

  function applyDone(result: {
    ok?: boolean;
    error?: string;
    points?: number;
    balanceAfter?: number;
    member?: {
      displayName?: string;
      cardNo?: string;
      pointsBalance?: number;
      isNew?: boolean;
    };
  }) {
    if (!result.ok) {
      if (result.error === "phone_required" || result.error === "phone_otp_required") {
        setError(giftErrorLabel(result.error));
        setStep("link_phone");
        return false;
      }
      if (isAlreadyUsedError(result.error)) {
        setError(null);
        setStep("used");
        return false;
      }
      setError(giftErrorLabel(result.error));
      return false;
    }
    setDone({
      displayName: result.member?.displayName || name || phone || "เพื่อน TellTea",
      cardNo: result.member?.cardNo || "—",
      points: typeof result.points === "number" ? result.points : 0,
      balance:
        typeof result.balanceAfter === "number"
          ? result.balanceAfter
          : typeof result.member?.pointsBalance === "number"
            ? result.member.pointsBalance
            : 0,
      isNew: result.member?.isNew === true,
    });
    setPopupOpen(true);
    setStep("done");
    return true;
  }

  async function afterSignedIn() {
    setBusy(true);
    setError(null);
    try {
      const info = await lookupCompCouponAuth(token);
      setAuthInfo(info);
      if (!info.ok) {
        if (isAlreadyUsedError(info.error)) {
          setStep("used");
          setError(null);
          return;
        }
        setError(giftErrorLabel(info.error));
        return;
      }
      if (info.found) {
        setStep("confirm");
        return;
      }
      setStep("link_phone");
    } catch (err) {
      setError(mapFirebaseAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onGoogle() {
    setBusy(true);
    setError(null);
    try {
      const user = await signInMemberWithGoogle();
      if (!user) return;
      await afterSignedIn();
    } catch (err) {
      setError(mapFirebaseAuthError(err));
      setBusy(false);
    }
  }

  async function onSendOtp(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const conf = await sendPhoneOtp(phone, "gift-recaptcha");
      setConfirmation(conf);
      setOtpPurpose("auth");
      setOtp("");
      setStep("otp");
    } catch (err) {
      setError(mapFirebaseAuthError(err));
      resetPhoneRecaptcha();
    } finally {
      setBusy(false);
    }
  }

  async function onSendLinkPhoneOtp(e: FormEvent) {
    e.preventDefault();
    if (!pdpa) {
      setError("กดยอมรับก่อนนะ");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (!currentAuthHasVerifiedPhone()) {
        const conf = await sendLinkPhoneOtp(phone, "gift-recaptcha");
        setConfirmation(conf);
        setOtpPurpose("link_claim");
        setOtp("");
        setStep("otp");
        return;
      }
      const result = await submitCompCouponClaim({
        token,
        phone,
        displayName: name,
        pdpaAccepted: true,
      });
      applyDone(result);
    } catch (err) {
      setError(mapFirebaseAuthError(err));
      resetPhoneRecaptcha();
    } finally {
      setBusy(false);
    }
  }

  async function onConfirmOtp(e: FormEvent) {
    e.preventDefault();
    if (!confirmation) return;
    setBusy(true);
    setError(null);
    try {
      await confirmPhoneOtp(confirmation, otp);
      if (otpPurpose === "link_claim") {
        const result = await submitCompCouponClaim({
          token,
          phone,
          displayName: name,
          pdpaAccepted: true,
        });
        applyDone(result);
        return;
      }
      await afterSignedIn();
    } catch (err) {
      setError(mapFirebaseAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onClaimExisting() {
    setBusy(true);
    setError(null);
    try {
      const result = await submitCompCouponClaim({ token });
      applyDone(result);
    } catch (err) {
      setError(mapFirebaseAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  const pointsLabel = pointsPreview ?? authInfo?.pointsPreview ?? 1;

  return (
    <main className="join-page">
      <div className="join-card">
        <p className="join-brand">TellTea</p>
        <h1 className="join-title">รับแต้มจากร้าน</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          สแกน QR ให้แต้ม · ได้ {pointsLabel} แต้ม
        </p>

        {step === "load" || (busy && step === "auth" && !error) ? (
          <p className="muted" style={{ marginTop: "1rem" }}>
            แป๊บหนึ่ง...
          </p>
        ) : null}

        {step === "used" ? (
          <div className="join-form claim-used">
            <p className="claim-used-title">ได้แต้มจาก QR นี้ไปแล้ว</p>
            <p className="muted">ใบนี้ใช้ครั้งเดียว · ดูแต้มได้ทุกเมื่อ</p>
            <a className="primary-btn claim-used-cta" href="/me/">
              ดูแต้มของฉัน
            </a>
          </div>
        ) : null}

        {step === "blocked" ? (
          <div className="join-form claim-used">
            <p className="claim-used-title">{giftBlockedTitle(blockedCode)}</p>
            <p className="muted">{error || "สแกน QR จากสลิปใหม่ได้ หรือดูแต้มที่มีอยู่"}</p>
            <a className="primary-btn claim-used-cta" href="/me/">
              ดูแต้มของฉัน
            </a>
          </div>
        ) : null}

        {step === "auth" ? (
          <div className="join-form">
            <p className="muted" style={{ marginTop: 0 }}>
              ใช้เบอร์มือถือไทยรับรหัส — หรือเข้าด้วย Google
            </p>
            {showPhoneAlt ? (
              <form onSubmit={onSendOtp} className="join-form" style={{ marginTop: 0 }}>
                <label>
                  <span>เบอร์มือถือ (06 / 08 / 09)</span>
                  <input
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    disabled={busy}
                    placeholder="08x-xxx-xxxx"
                  />
                </label>
                <button type="submit" className="primary-btn" disabled={busy}>
                  {busy ? "กำลังส่ง..." : "ส่งรหัสไปเบอร์นี้"}
                </button>
              </form>
            ) : null}
            <button
              type="button"
              className={showPhoneAlt ? "ghost-btn" : "primary-btn claim-google-btn"}
              disabled={busy}
              onClick={() => void onGoogle()}
            >
              {busy ? "แป๊บหนึ่ง..." : "เข้าด้วย Google"}
            </button>
            <button
              type="button"
              className="claim-phone-link"
              disabled={busy}
              onClick={() => setShowPhoneAlt((v) => !v)}
            >
              {showPhoneAlt ? "ซ่อนฟอร์มเบอร์" : "ใช้เบอร์แทน"}
            </button>
            {error ? <p className="join-error">{error}</p> : null}
          </div>
        ) : null}

        {step === "otp" ? (
          <form onSubmit={onConfirmOtp} className="join-form">
            <p className="muted">ส่งรหัสไปที่ {phone} แล้ว</p>
            <label>
              <span>รหัส 6 หลัก</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                required
                disabled={busy}
                placeholder="••••••"
              />
            </label>
            {error ? <p className="join-error">{error}</p> : null}
            <button type="submit" className="primary-btn" disabled={busy}>
              {busy
                ? "แป๊บหนึ่ง..."
                : otpPurpose === "link_claim"
                  ? "รับแต้มเลย"
                  : "ต่อไป"}
            </button>
          </form>
        ) : null}

        {step === "confirm" && authInfo?.member ? (
          <div className="join-form">
            <p>
              สวัสดี <strong>{authInfo.member.displayName}</strong>
            </p>
            <p>
              ได้ <strong>+{pointsLabel}</strong> แต้ม
            </p>
            {error ? <p className="join-error">{error}</p> : null}
            <button
              type="button"
              className="primary-btn"
              disabled={busy}
              onClick={() => void onClaimExisting()}
            >
              {busy ? "แป๊บหนึ่ง..." : "รับแต้มเลย"}
            </button>
          </div>
        ) : null}

        {step === "link_phone" ? (
          <form onSubmit={onSendLinkPhoneOtp} className="join-form">
            <p className="muted">
              {authInfo?.email ? `สวัสดี ${authInfo.email}` : "อีกนิดเดียว"}
              {" · "}ใส่เบอร์เพื่อรับแต้ม
            </p>
            <label>
              <span>เบอร์โทร</span>
              <input
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                disabled={busy}
                placeholder="08x-xxx-xxxx"
              />
            </label>
            <label>
              <span>ชื่อเล่น (ไม่บังคับ)</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
                placeholder="เรียกยังไงดี"
              />
            </label>
            <label className="claim-pdpa">
              <input
                type="checkbox"
                checked={pdpa}
                disabled={busy}
                onChange={(e) => setPdpa(e.target.checked)}
              />
              <span>โอเค ให้ร้านเก็บเบอร์·ชื่อ·อีเมล เพื่อสะสมแต้ม</span>
            </label>
            {error ? <p className="join-error">{error}</p> : null}
            <button type="submit" className="primary-btn" disabled={busy || !pdpa}>
              {busy
                ? "กำลังส่ง..."
                : currentAuthHasVerifiedPhone()
                  ? `รับ ${pointsLabel} แต้มเลย`
                  : "ส่งรหัสยืนยันเบอร์"}
            </button>
          </form>
        ) : null}

        <div id="gift-recaptcha" />
      </div>

      {step === "done" && done && !popupOpen ? (
        <div className="join-done" style={{ marginTop: "1rem" }}>
          <p>
            ได้แต้มแล้ว · รวม <strong>{done.balance}</strong>
          </p>
          <p className="muted">
            <a href="/me/">ดูแต้มของฉัน</a>
          </p>
        </div>
      ) : null}

      {popupOpen && done ? (
        <div className="claim-success-overlay" role="dialog" aria-modal="true">
          <div className="claim-success-popup">
            <p className="claim-success-brand">TellTea</p>
            <p className="claim-success-title">
              {done.isNew ? "สมัครแล้ว ได้แต้มเลย!" : "เย้ ได้แต้มแล้ว!"}
            </p>
            <p className="claim-success-points">
              +<strong>{done.points}</strong>
            </p>
            <p style={{ marginTop: "0.75rem" }}>
              รวมตอนนี้ <strong>{done.balance}</strong> แต้ม
              {" · "}ลดได้ถึง <strong>{done.balance}</strong> บาท
            </p>
            <p className="muted" style={{ marginTop: "0.35rem" }}>
              {done.displayName}
            </p>
            <ClaimPointsValueNote />
            <a
              className="primary-btn claim-used-cta"
              href="/me/"
              style={{ marginTop: "1rem" }}
            >
              ดูแต้มของฉัน
            </a>
            <button
              type="button"
              className="claim-phone-link"
              style={{ marginTop: "0.35rem" }}
              onClick={() => setPopupOpen(false)}
            >
              ปิด
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}

export default function GiftPage() {
  return (
    <Suspense
      fallback={
        <main className="join-page">
          <p className="muted">แป๊บหนึ่ง...</p>
        </main>
      }
    >
      <GiftForm />
    </Suspense>
  );
}
