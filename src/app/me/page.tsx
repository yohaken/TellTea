"use client";

import { FormEvent, useEffect, useState } from "react";
import type { ConfirmationResult } from "firebase/auth";
import { completeGoogleAuthBridgeFromUrl, mapFirebaseAuthError } from "@/lib/auth";
import { confirmPhoneOtp, resetPhoneRecaptcha, sendPhoneOtp } from "@/lib/phone-auth";
import {
  claimErrorLabel,
  fetchMemberMe,
  signInMemberWithGoogle,
  type MemberMeResult,
} from "@/lib/receipt-claim";

type Step = "auth" | "phone" | "otp" | "card";

export default function MemberMePage() {
  const [step, setStep] = useState<Step>("auth");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<MemberMeResult | null>(null);

  async function loadMe() {
    setBusy(true);
    setError(null);
    try {
      const data = await fetchMemberMe();
      setMe(data);
      if (!data.ok) {
        setError(claimErrorLabel(data.error));
        return;
      }
      if (!data.found) {
        setError("ยังไม่เจอสมาชิก · สแกน QR จากสลิปก่อนนะ");
        return;
      }
      setStep("card");
    } catch (err) {
      setError(mapFirebaseAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const bridged = await completeGoogleAuthBridgeFromUrl();
        if (cancelled || !bridged) return;
        await loadMe();
      } catch (err) {
        if (!cancelled) setError(mapFirebaseAuthError(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onGoogle() {
    setBusy(true);
    setError(null);
    try {
      const user = await signInMemberWithGoogle();
      if (!user) return;
      await loadMe();
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
      const conf = await sendPhoneOtp(phone, "me-recaptcha");
      setConfirmation(conf);
      setStep("otp");
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
      await loadMe();
    } catch (err) {
      setError(mapFirebaseAuthError(err));
      resetPhoneRecaptcha();
      setBusy(false);
    }
  }

  return (
    <main className="join-page">
      <div className="join-card">
        <p className="join-brand">TellTea</p>
        <h1>แต้มของฉัน</h1>
        <p className="muted">เข้าด้วย Google หรือเบอร์ก็ได้</p>

        {step === "auth" ? (
          <div className="join-form">
            <button
              type="button"
              className="primary-btn claim-google-btn"
              disabled={busy}
              onClick={() => void onGoogle()}
            >
              {busy ? "แป๊บหนึ่ง..." : "เข้าด้วย Google"}
            </button>
            <button
              type="button"
              className="claim-phone-link"
              disabled={busy}
              onClick={() => setStep("phone")}
            >
              ใช้เบอร์แทน
            </button>
            {error ? <p className="join-error">{error}</p> : null}
          </div>
        ) : null}

        {step === "phone" ? (
          <form onSubmit={onSendOtp} className="join-form">
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
            {error ? <p className="join-error">{error}</p> : null}
            <button type="submit" className="primary-btn" disabled={busy}>
              {busy ? "กำลังส่ง..." : "ส่งรหัส"}
            </button>
            <button
              type="button"
              className="ghost-btn"
              disabled={busy}
              onClick={() => setStep("auth")}
            >
              กลับ
            </button>
          </form>
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
              {busy ? "แป๊บหนึ่ง..." : "ดูแต้ม"}
            </button>
          </form>
        ) : null}

        {step === "card" && me?.member ? (
          <div className="join-done">
            <p>
              สวัสดี <strong>{me.member.displayName}</strong>
            </p>
            <p className="muted">{me.member.phoneDisplay}</p>
            <p className="claim-success-points" style={{ marginTop: "0.75rem" }}>
              <strong>{me.member.pointsBalance}</strong>
            </p>
            <p className="muted">แต้มที่มี</p>
            <p className="muted" style={{ marginTop: "0.5rem" }}>
              สะสมมาแล้ว {me.member.lifetimePointsEarned ?? 0}
            </p>
          </div>
        ) : null}

        <div id="me-recaptcha" />
      </div>
    </main>
  );
}
