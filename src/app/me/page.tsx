"use client";

import { FormEvent, useState } from "react";
import type { ConfirmationResult } from "firebase/auth";
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
        setError("ยังไม่พบสมาชิกในเบอร์/บัญชีนี้ — สะสมแต้มจากสลิปก่อน");
        return;
      }
      setStep("card");
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function onGoogle() {
    setBusy(true);
    setError(null);
    try {
      await signInMemberWithGoogle();
      await loadMe();
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
      const conf = await sendPhoneOtp(phone, "me-recaptcha");
      setConfirmation(conf);
      setStep("otp");
    } catch (err) {
      setError(err instanceof Error ? err.message : "ส่ง OTP ไม่สำเร็จ");
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
      setError(err instanceof Error ? err.message : "ยืนยัน OTP ไม่สำเร็จ");
      resetPhoneRecaptcha();
      setBusy(false);
    }
  }

  return (
    <main className="join-page">
      <div className="join-card">
        <p className="join-brand">TellTea</p>
        <h1>ดูแต้มสมาชิก</h1>
        <p className="muted">ต้องเข้าสู่ระบบ — ไม่แสดงแต้มจากเบอร์เปล่าๆ</p>

        {step === "auth" ? (
          <div className="join-form">
            <button
              type="button"
              className="primary-btn claim-google-btn"
              disabled={busy}
              onClick={() => void onGoogle()}
            >
              {busy ? "กำลังเข้าสู่ระบบ..." : "เข้าด้วย Google"}
            </button>
            <button
              type="button"
              className="claim-phone-link"
              disabled={busy}
              onClick={() => setStep("phone")}
            >
              ใช้เบอร์ + OTP
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
              {busy ? "กำลังส่ง..." : "ส่ง OTP"}
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
            <p className="muted">ส่งรหัสไปที่ {phone}</p>
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
              />
            </label>
            {error ? <p className="join-error">{error}</p> : null}
            <button type="submit" className="primary-btn" disabled={busy}>
              {busy ? "กำลังตรวจ..." : "ดูแต้ม"}
            </button>
          </form>
        ) : null}

        {step === "card" && me?.member ? (
          <div className="join-done">
            <p>
              <strong>{me.member.displayName}</strong>
            </p>
            <p className="muted">
              {me.member.phoneDisplay} · บัตร {me.member.cardNo}
            </p>
            <p className="claim-success-points" style={{ marginTop: "0.75rem" }}>
              <strong>{me.member.pointsBalance}</strong>
            </p>
            <p className="muted">แต้มคงเหลือ</p>
            <p className="muted" style={{ marginTop: "0.5rem" }}>
              สะสมรวม {me.member.lifetimePointsEarned ?? 0}
            </p>
          </div>
        ) : null}

        <div id="me-recaptcha" />
      </div>
    </main>
  );
}
