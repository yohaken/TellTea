"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ConfirmationResult } from "firebase/auth";
import { confirmPhoneOtp, resetPhoneRecaptcha, sendPhoneOtp } from "@/lib/phone-auth";
import {
  claimErrorLabel,
  fetchReceiptClaimPreview,
  submitReceiptClaim,
  type ReceiptClaimPreview,
} from "@/lib/receipt-claim";

type Step = "load" | "form" | "otp" | "done" | "blocked";

function ClaimForm() {
  const params = useSearchParams();
  const saleId = useMemo(() => (params.get("s") || params.get("saleId") || "").trim(), [params]);
  const token = useMemo(() => (params.get("t") || params.get("token") || "").trim(), [params]);

  const [step, setStep] = useState<Step>("load");
  const [preview, setPreview] = useState<ReceiptClaimPreview | null>(null);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [pdpa, setPdpa] = useState(false);
  const [otp, setOtp] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
          setStep("blocked");
          setError(claimErrorLabel(data.error));
          return;
        }
        setStep("form");
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

  async function onSendOtp(e: FormEvent) {
    e.preventDefault();
    if (!pdpa) {
      setError("กรุณายินยอมนโยบายข้อมูลส่วนบุคคล");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const conf = await sendPhoneOtp(phone, "claim-recaptcha");
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
      const result = await submitReceiptClaim({
        saleId,
        token,
        displayName: name,
        pdpaAccepted: true,
      });
      if (!result.ok) {
        setError(claimErrorLabel(result.error));
        return;
      }
      setDone({
        displayName: result.member?.displayName || name || phone,
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
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "ยืนยัน OTP ไม่สำเร็จ");
      resetPhoneRecaptcha();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="join-page">
      <div className="join-card">
        <p className="join-brand">TellTea</p>
        <h1>สะสมแต้มจากสลิป</h1>
        <p className="muted">โหมดทดลอง · สแกนแล้วยืนยันเบอร์เพื่อรับแต้ม</p>

        {preview?.ok ? (
          <p className="muted" style={{ marginTop: "0.75rem" }}>
            บิล {preview.billNo} · ยอด {preview.total} บาท →{" "}
            <strong>{preview.pointsPreview}</strong> แต้ม
            {typeof preview.earnPercent === "number" ? ` (${preview.earnPercent}%)` : ""}
          </p>
        ) : null}

        {step === "load" ? (
          <p className="muted" style={{ marginTop: "1rem" }}>
            กำลังตรวจสอบลิงก์...
          </p>
        ) : null}

        {step === "blocked" ? (
          <p className="join-error" style={{ marginTop: "1rem" }}>
            {error || "ลิงก์ใช้ไม่ได้"}
          </p>
        ) : null}

        {step === "form" ? (
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
            <label>
              <span>ชื่อเรียก (ถ้าสมัครใหม่)</span>
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
              <span>
                ยินยอมให้ร้านเก็บเบอร์/ชื่อเพื่อสะสมแต้มและติดต่อเรื่องสมาชิก
                (ใช้เฉพาะสาขานี้ · ถอนความยินยอมได้โดยแจ้งร้าน)
              </span>
            </label>
            {error ? <p className="join-error">{error}</p> : null}
            <button type="submit" className="primary-btn" disabled={busy || !pdpa}>
              {busy ? "กำลังส่ง OTP..." : "ส่งรหัส OTP"}
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
                placeholder="6 หลัก"
              />
            </label>
            {error ? <p className="join-error">{error}</p> : null}
            <button type="submit" className="primary-btn" disabled={busy}>
              {busy ? "กำลังเคลม..." : "ยืนยันและรับแต้ม"}
            </button>
            <button
              type="button"
              className="ghost-btn"
              disabled={busy}
              onClick={() => {
                setStep("form");
                setOtp("");
                setConfirmation(null);
                resetPhoneRecaptcha();
              }}
            >
              แก้เบอร์
            </button>
          </form>
        ) : null}

        {step === "done" && done ? (
          <div className="join-done">
            <p>
              {done.isNew ? "สมัครและรับแต้มแล้ว" : "รับแต้มแล้ว"} ·{" "}
              <strong>{done.displayName}</strong>
            </p>
            <p className="muted">บัตร {done.cardNo}</p>
            <p>
              ได้ +<strong>{done.points}</strong> แต้ม · ยอดรวม{" "}
              <strong>{done.balance}</strong>
            </p>
          </div>
        ) : null}

        <div id="claim-recaptcha" />
      </div>
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
