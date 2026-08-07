"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  claimErrorLabel,
  fetchReceiptClaimPreview,
  lookupReceiptClaimMember,
  submitExistingReceiptClaim,
  submitReceiptClaim,
  type ReceiptClaimLookup,
  type ReceiptClaimPreview,
} from "@/lib/receipt-claim";

type Step = "load" | "phone" | "confirm" | "signup" | "done" | "blocked";

function ClaimForm() {
  const params = useSearchParams();
  const saleId = useMemo(() => (params.get("s") || params.get("saleId") || "").trim(), [params]);
  const token = useMemo(() => (params.get("t") || params.get("token") || "").trim(), [params]);

  const [step, setStep] = useState<Step>("load");
  const [preview, setPreview] = useState<ReceiptClaimPreview | null>(null);
  const [lookup, setLookup] = useState<ReceiptClaimLookup | null>(null);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [pdpa, setPdpa] = useState(false);
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
        setStep("phone");
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
      setError(claimErrorLabel(result.error));
      if (result.error === "already_claimed" || result.error === "already_earned") {
        setStep("blocked");
      }
      return false;
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
    return true;
  }

  async function onCheckPhone(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setLookup(null);
    try {
      const data = await lookupReceiptClaimMember({ saleId, token, phone });
      if (!data.ok) {
        setError(claimErrorLabel(data.error));
        if (data.error === "already_claimed" || data.error === "already_earned") {
          setStep("blocked");
        }
        return;
      }
      setLookup(data);
      setStep(data.found ? "confirm" : "signup");
    } catch {
      setError("เชื่อมต่อไม่ได้ ลองใหม่");
    } finally {
      setBusy(false);
    }
  }

  async function onConfirmExisting(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await submitExistingReceiptClaim({ saleId, token, phone });
      applyDone(result);
    } catch {
      setError("เคลมไม่สำเร็จ ลองใหม่");
    } finally {
      setBusy(false);
    }
  }

  async function onSignupClaim(e: FormEvent) {
    e.preventDefault();
    if (!pdpa) {
      setError("กรุณายินยอมนโยบายข้อมูลส่วนบุคคล");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // ช่วงทดลอง: สมัครด้วยเบอร์โดยไม่ OTP — QR ใบนี้ใช้ได้ครั้งเดียวหลังเคลม
      const result = await submitReceiptClaim({
        saleId,
        token,
        phone,
        displayName: name,
        pdpaAccepted: true,
      });
      applyDone(result);
    } catch {
      setError("สมัคร/เคลมไม่สำเร็จ ลองใหม่");
    } finally {
      setBusy(false);
    }
  }

  const pointsLabel =
    typeof preview?.pointsPreview === "number" ? preview.pointsPreview : lookup?.pointsPreview;

  return (
    <main className="join-page">
      <div className="join-card">
        <p className="join-brand">TellTea</p>
        <h1>สะสมแต้มจากสลิป</h1>
        <p className="muted">ใส่เบอร์ · ยืนยัน · รับแต้ม · QR ใช้ได้ครั้งเดียว</p>

        {preview?.ok ? (
          <p className="muted" style={{ marginTop: "0.75rem" }}>
            บิล {preview.billNo} · ยอด {preview.total} บาท →{" "}
            <strong>{preview.pointsPreview}</strong> แต้ม
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

        {step === "phone" ? (
          <form onSubmit={onCheckPhone} className="join-form">
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
                autoFocus
              />
            </label>
            {error ? <p className="join-error">{error}</p> : null}
            <button type="submit" className="primary-btn" disabled={busy || !phone.trim()}>
              {busy ? "กำลังตรวจ..." : "ต่อไป"}
            </button>
          </form>
        ) : null}

        {step === "confirm" && lookup?.found && lookup.member ? (
          <form onSubmit={onConfirmExisting} className="join-form">
            <p>
              รับ <strong>{pointsLabel ?? "—"}</strong> แต้ม เข้า
            </p>
            <p>
              <strong>{lookup.member.displayName}</strong>
            </p>
            <p className="muted">
              {lookup.phoneDisplay || phone} · บัตร {lookup.member.cardNo} · มี{" "}
              {lookup.member.pointsBalance} แต้ม
            </p>
            {error ? <p className="join-error">{error}</p> : null}
            <button type="submit" className="primary-btn" disabled={busy}>
              {busy ? "กำลังเคลม..." : "ยืนยันรับแต้ม"}
            </button>
            <button
              type="button"
              className="ghost-btn"
              disabled={busy}
              onClick={() => {
                setStep("phone");
                setLookup(null);
                setError(null);
              }}
            >
              เปลี่ยนเบอร์
            </button>
          </form>
        ) : null}

        {step === "signup" ? (
          <form onSubmit={onSignupClaim} className="join-form">
            <p className="muted">เบอร์ {lookup?.phoneDisplay || phone} · ยังไม่เป็นสมาชิก</p>
            <label>
              <span>ชื่อเรียก</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
                placeholder="ชื่อเล่น"
                autoFocus
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
                ยินยอมให้ร้านเก็บเบอร์/ชื่อเพื่อสะสมแต้ม (สาขานี้ · แจ้งร้านเพื่อถอนได้)
              </span>
            </label>
            {error ? <p className="join-error">{error}</p> : null}
            <button type="submit" className="primary-btn" disabled={busy || !pdpa}>
              {busy ? "กำลังสมัคร..." : `สมัครและรับ ${pointsLabel ?? ""} แต้ม`}
            </button>
            <button
              type="button"
              className="ghost-btn"
              disabled={busy}
              onClick={() => {
                setStep("phone");
                setLookup(null);
                setError(null);
              }}
            >
              เปลี่ยนเบอร์
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
              ได้ +<strong>{done.points}</strong> แต้ม · รวม <strong>{done.balance}</strong>
            </p>
            <p className="muted" style={{ marginTop: "0.75rem" }}>
              QR ใบนี้ใช้แล้ว — สลิปถัดไปสแกนใบใหม่
            </p>
          </div>
        ) : null}
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
