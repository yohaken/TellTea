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
import { completeGoogleAuthBridgeFromUrl, mapFirebaseAuthError } from "@/lib/auth";
import {
  claimBlockedTitle,
  claimErrorLabel,
  fetchReceiptClaimPreview,
  lookupReceiptClaimAuth,
  signInMemberWithGoogle,
  submitReceiptClaim,
  type ReceiptClaimAuthLookup,
  type ReceiptClaimPreview,
} from "@/lib/receipt-claim";

type Step =
  | "load"
  | "auth"
  | "phone_otp"
  | "otp"
  | "link_phone"
  | "confirm"
  | "done"
  | "used"
  | "no_points"
  | "blocked";

function isAlreadyUsedError(code: string | undefined): boolean {
  return code === "already_claimed" || code === "already_earned";
}

function ClaimForm() {
  const params = useSearchParams();
  const saleId = useMemo(() => (params.get("s") || params.get("saleId") || "").trim(), [params]);
  const token = useMemo(() => (params.get("t") || params.get("token") || "").trim(), [params]);

  const [step, setStep] = useState<Step>("load");
  const [preview, setPreview] = useState<ReceiptClaimPreview | null>(null);
  const [authInfo, setAuthInfo] = useState<ReceiptClaimAuthLookup | null>(null);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [pdpa, setPdpa] = useState(false);
  const [otp, setOtp] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPhoneAlt, setShowPhoneAlt] = useState(false);
  /** auth = phone-only login · link_claim = first-time Google→phone OTP then claim */
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
      if (!saleId || !token) {
        setStep("blocked");
        setBlockedCode("bad_token");
        setError("ลิงก์ไม่ครบ สแกน QR จากสลิปอีกครั้งนะ");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        // Return from Google auth bridge (?ticket=) — finish session before UI.
        try {
          const bridged = await completeGoogleAuthBridgeFromUrl();
          if (cancelled) return;
          if (bridged) {
            const data = await fetchReceiptClaimPreview(saleId, token);
            if (cancelled) return;
            setPreview(data);
            if (!data.ok) {
              if (data.error === "zero_points") {
                setStep("no_points");
                setError(null);
                return;
              }
              if (isAlreadyUsedError(data.error)) {
                setStep("used");
                setError(null);
                return;
              }
              setStep("blocked");
              setBlockedCode(data.error);
              setError(claimErrorLabel(data.error));
              return;
            }
            setStep("auth");
            setBusy(true);
            const info = await lookupReceiptClaimAuth({ saleId, token });
            if (cancelled) return;
            setAuthInfo(info);
            if (!info.ok) {
              if (isAlreadyUsedError(info.error)) {
                setStep("used");
                setError(null);
                return;
              }
              if (info.error === "zero_points") {
                setStep("no_points");
                setError(null);
                return;
              }
              setError(claimErrorLabel(info.error));
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

        const data = await fetchReceiptClaimPreview(saleId, token);
        if (cancelled) return;
        setPreview(data);
        if (!data.ok) {
          if (data.error === "zero_points") {
            setStep("no_points");
            setError(null);
            return;
          }
          if (isAlreadyUsedError(data.error)) {
            setStep("used");
            setError(null);
            return;
          }
          setStep("blocked");
          setBlockedCode(data.error);
          setError(claimErrorLabel(data.error));
          return;
        }
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
  }, [saleId, token]);

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
      if (result.error === "phone_required") {
        setError(claimErrorLabel(result.error));
        setStep("link_phone");
        return false;
      }
      if (result.error === "zero_points") {
        setError(null);
        setStep("no_points");
        return false;
      }
      if (isAlreadyUsedError(result.error)) {
        setError(null);
        setStep("used");
        return false;
      }
      setError(claimErrorLabel(result.error));
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
      const info = await lookupReceiptClaimAuth({ saleId, token });
      setAuthInfo(info);
      if (!info.ok) {
        if (isAlreadyUsedError(info.error)) {
          setStep("used");
          setError(null);
          return;
        }
        if (info.error === "zero_points") {
          setStep("no_points");
          setError(null);
          return;
        }
        setError(claimErrorLabel(info.error));
        return;
      }
      if (info.found) {
        setStep("confirm");
        return;
      }
      if (info.needsPhone) {
        setStep("link_phone");
        return;
      }
      // phone auth already on token but no member yet
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
      if (!user) return; // redirected to auth bridge
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
      const conf = await sendPhoneOtp(phone, "claim-recaptcha");
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
      // First-time Google signup: OTP must verify phone before create member.
      if (!currentAuthHasVerifiedPhone()) {
        const conf = await sendLinkPhoneOtp(phone, "claim-recaptcha");
        setConfirmation(conf);
        setOtpPurpose("link_claim");
        setOtp("");
        setStep("otp");
        return;
      }
      const result = await submitReceiptClaim({
        saleId,
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
        const result = await submitReceiptClaim({
          saleId,
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
      resetPhoneRecaptcha();
    } finally {
      setBusy(false);
    }
  }

  async function onClaimExisting() {
    setBusy(true);
    setError(null);
    try {
      const result = await submitReceiptClaim({ saleId, token });
      applyDone(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "รับแต้มไม่สำเร็จ ลองใหม่นะ");
    } finally {
      setBusy(false);
    }
  }

  const pointsLabel = preview?.pointsPreview;
  const showBillMeta = preview?.ok || step === "used" || step === "no_points";

  return (
    <main className="join-page">
      <div className="join-card">
        <p className="join-brand">TellTea</p>
        <h1>ได้แต้มจากบิลนี้</h1>
        {showBillMeta ? (
          <p className="muted claim-bill-meta">
            {typeof preview?.pointsPreview === "number" && step !== "no_points" ? (
              <>
                ได้ <strong>{preview.pointsPreview}</strong> แต้ม
                {preview?.billNo ? ` · บิล ${preview.billNo}` : ""}
              </>
            ) : (
              <>
                {preview?.billNo ? `บิล ${preview.billNo}` : "บิลนี้"}
                {typeof preview?.total === "number" ? ` · ${preview.total} บาท` : ""}
              </>
            )}
          </p>
        ) : (
          <p className="muted">สแกนจากสลิป TellTea</p>
        )}

        {step === "load" ? (
          <p className="muted" style={{ marginTop: "1rem" }}>
            แป๊บหนึ่ง...
          </p>
        ) : null}

        {step === "used" ? (
          <div className="join-form claim-used">
            <p className="claim-used-title">ได้แต้มจากบิลนี้ไปแล้ว</p>
            <p className="muted">QR ใบนี้ใช้แล้ว · ดูแต้มได้ทุกเมื่อ</p>
            <a className="primary-btn claim-used-cta" href="/me/">
              ดูแต้มของฉัน
            </a>
          </div>
        ) : null}

        {step === "no_points" ? (
          <div className="join-form claim-used">
            <p className="claim-used-title">บิลนี้ยังไม่มีแต้ม</p>
            <p className="muted">อาจยังไม่ถึงยอดสะสม หรือใช้แต้มจ่ายไปแล้ว</p>
            <a className="primary-btn claim-used-cta" href="/me/">
              ดูแต้มของฉัน
            </a>
          </div>
        ) : null}

        {step === "blocked" ? (
          <div className="join-form claim-used">
            <p className="claim-used-title">{claimBlockedTitle(blockedCode)}</p>
            <p className="muted">{error || "สแกน QR จากสลิปใหม่ได้ หรือดูแต้มที่มีอยู่"}</p>
            <a className="primary-btn claim-used-cta" href="/me/">
              ดูแต้มของฉัน
            </a>
          </div>
        ) : null}

        {step === "auth" ? (
          <div className="join-form">
            <p className="muted" style={{ marginTop: 0 }}>
              สมาชิกอยู่แล้วหรือสมัครใหม่ — เข้าแล้วรับแต้มจากบิลนี้ได้
            </p>
            <button
              type="button"
              className="primary-btn claim-google-btn"
              disabled={busy}
              onClick={() => void onGoogle()}
            >
              {busy ? "แป๊บหนึ่ง..." : "เข้าด้วย Google"}
            </button>
            {!showPhoneAlt ? (
              <button
                type="button"
                className="claim-phone-link"
                disabled={busy}
                onClick={() => setShowPhoneAlt(true)}
              >
                ใช้เบอร์แทน
              </button>
            ) : (
              <form onSubmit={onSendOtp} className="join-form" style={{ marginTop: 0 }}>
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
                <button type="submit" className="ghost-btn" disabled={busy}>
                  {busy ? "กำลังส่ง..." : "ส่งรหัส"}
                </button>
              </form>
            )}
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
              ได้ <strong>+{pointsLabel ?? "—"}</strong> แต้ม
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
                  ? `รับ ${pointsLabel ?? ""} แต้มเลย`
                  : "ส่งรหัสยืนยันเบอร์"}
            </button>
          </form>
        ) : null}

        <div id="claim-recaptcha" />
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
            </p>
            <p className="muted" style={{ marginTop: "0.35rem" }}>
              {done.displayName}
            </p>
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

export default function ClaimPage() {
  return (
    <Suspense
      fallback={
        <main className="join-page">
          <p className="muted">แป๊บหนึ่ง...</p>
        </main>
      }
    >
      <ClaimForm />
    </Suspense>
  );
}
