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
import {
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
        setError("ลิงก์ไม่ครบ — สแกน QR จากสลิปอีกครั้ง");
        return;
      }
      setBusy(true);
      setError(null);
      try {
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
          setError(claimErrorLabel(data.error));
          return;
        }
        setStep("auth");
      } catch {
        if (!cancelled) {
          setStep("blocked");
          setError("เชื่อมต่อไม่ได้ ลองใหม่");
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
      displayName: result.member?.displayName || name || phone || "สมาชิก",
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
      setError(err instanceof Error ? err.message : "ตรวจบัญชีไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function onGoogle() {
    setBusy(true);
    setError(null);
    try {
      await signInMemberWithGoogle();
      await afterSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เข้า Google ไม่สำเร็จ");
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
      setError(err instanceof Error ? err.message : "ส่ง OTP ไม่สำเร็จ");
      resetPhoneRecaptcha();
    } finally {
      setBusy(false);
    }
  }

  async function onSendLinkPhoneOtp(e: FormEvent) {
    e.preventDefault();
    if (!pdpa) {
      setError("กรุณายินยอมนโยบายข้อมูลส่วนบุคคล");
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
      setError(err instanceof Error ? err.message : "ส่ง OTP / สมัครไม่สำเร็จ");
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
      setError(err instanceof Error ? err.message : "ยืนยัน OTP ไม่สำเร็จ");
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
      setError(err instanceof Error ? err.message : "เคลมไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  const pointsLabel = preview?.pointsPreview;

  return (
    <main className="join-page">
      <div className="join-card">
        <p className="join-brand">TellTea</p>
        <h1>สะสมแต้มจากสลิป</h1>
        <p className="muted">Google ก่อน · ยืนยันเบอร์ด้วย OTP ครั้งแรก · QR ใช้ได้ครั้งเดียว</p>

        {preview?.ok || step === "used" || step === "no_points" ? (
          <p className="muted" style={{ marginTop: "0.75rem" }}>
            บิล {preview?.billNo || "—"}
            {typeof preview?.total === "number" ? ` · ยอดชำระ ${preview.total} บาท` : ""}
            {typeof preview?.pointsPreview === "number" && step !== "no_points" ? (
              <>
                {" "}
                → <strong>{preview.pointsPreview}</strong> แต้ม
              </>
            ) : null}
          </p>
        ) : null}

        {step === "load" ? (
          <p className="muted" style={{ marginTop: "1rem" }}>
            กำลังตรวจสอบลิงก์...
          </p>
        ) : null}

        {step === "used" ? (
          <div className="join-form claim-used">
            <p className="claim-used-title">แต้มบิลนี้ใช้แล้ว</p>
            <p className="muted">
              QR ใบนี้รับแต้มไปแล้ว · สแกนซ้ำไม่ได้ · ดูยอดแต้มของคุณได้หลังเข้าสู่ระบบ
            </p>
            <a className="primary-btn claim-used-cta" href="/me/">
              ดูแต้มของฉัน
            </a>
            <p className="muted claim-me-hint">
              หรือเปิด{" "}
              <a href="/me/">telltea-shop.web.app/me</a>
            </p>
          </div>
        ) : null}

        {step === "no_points" ? (
          <div className="join-form claim-used">
            <p className="claim-used-title">บิลนี้ยังไม่มีแต้มให้รับ</p>
            <p className="muted">
              ยอดชำระยังไม่ถึงเกณฑ์สะสม หรือจ่ายด้วยแต้มครบแล้ว · QR
              ยังใช้เข้าดูบัญชีสมาชิกได้
            </p>
            <a className="primary-btn claim-used-cta" href="/me/">
              ไปหน้าสมาชิก
            </a>
            <p className="muted claim-me-hint">
              เข้าสู่ระบบที่{" "}
              <a href="/me/">telltea-shop.web.app/me</a>
            </p>
          </div>
        ) : null}

        {step === "blocked" ? (
          <p className="join-error" style={{ marginTop: "1rem" }}>
            {error || "ลิงก์ใช้ไม่ได้"}
          </p>
        ) : null}

        {step === "auth" ? (
          <div className="join-form">
            <button
              type="button"
              className="primary-btn claim-google-btn"
              disabled={busy}
              onClick={() => void onGoogle()}
            >
              {busy ? "กำลังเข้าสู่ระบบ..." : "ดำเนินการต่อด้วย Google"}
            </button>
            {!showPhoneAlt ? (
              <button
                type="button"
                className="claim-phone-link"
                disabled={busy}
                onClick={() => setShowPhoneAlt(true)}
              >
                ใช้เบอร์โทรแทน
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
                  {busy ? "กำลังส่ง..." : "ส่ง OTP"}
                </button>
              </form>
            )}
            {error ? <p className="join-error">{error}</p> : null}
            <p className="muted claim-me-hint">
              ดูแต้มทีหลังที่{" "}
              <a href="/me/">telltea-shop.web.app/me</a> (ต้องเข้าสู่ระบบ)
            </p>
          </div>
        ) : null}

        {step === "otp" ? (
          <form onSubmit={onConfirmOtp} className="join-form">
            <p className="muted">
              {otpPurpose === "link_claim"
                ? `ยืนยันเบอร์ครั้งแรก · ส่งรหัสไปที่ ${phone}`
                : `ส่งรหัสไปที่ ${phone}`}
            </p>
            <label>
              <span>รหัส OTP</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                required
                disabled={busy}
                placeholder="6 หลัก"
              />
            </label>
            {error ? <p className="join-error">{error}</p> : null}
            <button type="submit" className="primary-btn" disabled={busy}>
              {busy
                ? "กำลังตรวจ..."
                : otpPurpose === "link_claim"
                  ? "ยืนยัน OTP แล้วสมัคร"
                  : "ยืนยัน OTP"}
            </button>
          </form>
        ) : null}

        {step === "confirm" && authInfo?.member ? (
          <div className="join-form">
            <p>
              รับ <strong>{pointsLabel ?? "—"}</strong> แต้ม เข้า
            </p>
            <p>
              <strong>{authInfo.member.displayName}</strong>
            </p>
            <p className="muted">บัตร {authInfo.member.cardNo}</p>
            {error ? <p className="join-error">{error}</p> : null}
            <button
              type="button"
              className="primary-btn"
              disabled={busy}
              onClick={() => void onClaimExisting()}
            >
              {busy ? "กำลังเคลม..." : "ยืนยันรับแต้ม"}
            </button>
          </div>
        ) : null}

        {step === "link_phone" ? (
          <form onSubmit={onSendLinkPhoneOtp} className="join-form">
            <p className="muted">
              {authInfo?.email
                ? `บัญชี ${authInfo.email} · กรอกเบอร์แล้วยืนยัน OTP ครั้งแรก`
                : "กรอกเบอร์แล้วยืนยัน OTP เพื่อสมัครครั้งแรก"}
            </p>
            <label>
              <span>เบอร์โทร *</span>
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
              <span>ชื่อเรียก</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
                placeholder="ชื่อเล่น"
              />
            </label>
            <label className="claim-pdpa">
              <input
                type="checkbox"
                checked={pdpa}
                disabled={busy}
                onChange={(e) => setPdpa(e.target.checked)}
              />
              <span>ยินยอมให้ร้านเก็บเบอร์/ชื่อ/อีเมลเพื่อสะสมแต้ม</span>
            </label>
            {error ? <p className="join-error">{error}</p> : null}
            <button type="submit" className="primary-btn" disabled={busy || !pdpa}>
              {busy
                ? "กำลังส่ง..."
                : currentAuthHasVerifiedPhone()
                  ? `สมัครและรับ ${pointsLabel ?? ""} แต้ม`
                  : "ส่ง OTP ยืนยันเบอร์"}
            </button>
          </form>
        ) : null}

        <div id="claim-recaptcha" />
      </div>

      {step === "done" && done && !popupOpen ? (
        <div className="join-done" style={{ marginTop: "1rem" }}>
          <p>รับแต้มแล้ว · รวม <strong>{done.balance}</strong></p>
          <p className="muted">
            ดูแต้มทีหลังที่ <a href="/me/">/me</a>
          </p>
        </div>
      ) : null}

      {popupOpen && done ? (
        <div className="claim-success-overlay" role="dialog" aria-modal="true">
          <div className="claim-success-popup">
            <p className="claim-success-brand">TellTea</p>
            <p className="claim-success-title">
              {done.isNew ? "สมัครและรับแต้มแล้ว" : "รับแต้มแล้ว"}
            </p>
            <p className="claim-success-points">
              +<strong>{done.points}</strong>
            </p>
            <p className="muted">แต้มในบิลนี้</p>
            <p style={{ marginTop: "0.75rem" }}>
              รวมตอนนี้ <strong>{done.balance}</strong> แต้ม
            </p>
            <p className="muted" style={{ marginTop: "0.35rem" }}>
              {done.displayName} · บัตร {done.cardNo}
            </p>
            <p className="muted" style={{ marginTop: "0.75rem", fontSize: "0.85rem" }}>
              QR ใบนี้ใช้แล้ว · ดูแต้มทีหลังที่ <a href="/me/">/me</a>
            </p>
            <button
              type="button"
              className="primary-btn"
              style={{ marginTop: "1rem", width: "100%" }}
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
          <p className="muted">กำลังโหลด...</p>
        </main>
      }
    >
      <ClaimForm />
    </Suspense>
  );
}
