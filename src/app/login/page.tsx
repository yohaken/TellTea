"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signInWithCustomToken } from "firebase/auth";
import { AUTH_LOADING_ESCAPE_MS, useAuth } from "@/lib/auth";
import { getFirebaseAuth } from "@/lib/firebase";
import { AppBrand } from "@/components/AppBrand";
import { staffHomeHref } from "@/lib/nav-menu";
import { cn } from "@/lib/utils";

function isInAppBrowser() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /Line\//i.test(ua) || /FBAN|FBAV/i.test(ua) || /Instagram/i.test(ua);
}

type LoginMode = "google" | "phone";

export default function LoginPage() {
  const { status, busyReason, signIn, signOut, sendPhoneLoginOtp, confirmPhoneLoginOtp, error } =
    useAuth();
  const router = useRouter();
  const [inApp, setInApp] = useState(false);
  const [mode, setMode] = useState<LoginMode>("google");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [showEscape, setShowEscape] = useState(false);

  useEffect(() => {
    setInApp(isInAppBrowser());
  }, []);

  /** Agent/QA: /login/?qaToken=<firebase-custom-token>&next=/ledger/?transferIn=1 */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const qaToken = (params.get("qaToken") || "").trim();
    if (!qaToken) return;
    let cancelled = false;
    setBusy(true);
    setLocalError(null);
    (async () => {
      try {
        await signInWithCustomToken(getFirebaseAuth(), qaToken);
        if (cancelled) return;
        const next = (params.get("next") || "/ledger/?transferIn=1").trim() || "/ledger/";
        router.replace(next.startsWith("/") ? next : "/ledger/");
      } catch (err) {
        if (!cancelled) {
          setLocalError((err as Error).message || "QA token ใช้ไม่ได้");
          setBusy(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (status === "ready") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("qaToken")) return;
      // ตามสิทธิ์ — พนักงานหน้าร้านมักไม่มี ledger; อย่าบังคับ /ledger แล้วเด้งวน
      router.replace(staffHomeHref(staff));
    }
  }, [status, staff, router]);

  useEffect(() => {
    if (status !== "loading" || busyReason === "boot" || busyReason == null) {
      setShowEscape(false);
      return;
    }
    const timer = window.setTimeout(() => setShowEscape(true), AUTH_LOADING_ESCAPE_MS);
    return () => window.clearTimeout(timer);
  }, [status, busyReason]);

  const blocked = status === "unconfigured";
  const signingIn = busyReason === "bridge" || busyReason === "staff";
  const displayError = localError || error;

  async function onSendOtp(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setLocalError(null);
    try {
      await sendPhoneLoginOtp(phone, "phone-recaptcha");
      setOtpSent(true);
    } catch (err) {
      setLocalError((err as Error).message || "ส่ง OTP ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function onConfirmOtp(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setLocalError(null);
    try {
      await confirmPhoneLoginOtp(otp);
    } catch (err) {
      setLocalError((err as Error).message || "ยืนยัน OTP ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="hero-login">
      <div className="hero-copy">
        <AppBrand className="hero-brand" showLogo />
        <p>บัญชีร้าน — เจ้าของโอนเข้า พนักงานบันทึกเงินออก</p>
      </div>
      <div className="hero-actions">
        {inApp ? (
          <p className="error-text" style={{ marginBottom: "0.75rem" }}>
            เปิดจาก LINE/แชทมักล็อกอินไม่ได้ — กด ⋯ แล้วเลือก “เปิดในเบราว์เซอร์”
            (Safari หรือ Chrome)
          </p>
        ) : null}
        {status === "unconfigured" ? (
          <p className="error-text">
            ยังไม่ได้ตั้งค่า Firebase — คัดลอก `.env.example` เป็น `.env.local` แล้วใส่ค่าจาก Firebase Console
          </p>
        ) : null}
        {displayError ? <p className="error-text">{displayError}</p> : null}
        {status === "denied" ? (
          <p className="muted" style={{ marginBottom: "0.75rem", textAlign: "left" }}>
            บัญชีนี้ยังไม่อยู่ในรายชื่อพนักงาน ให้เจ้าของเพิ่มอีเมลหรือเบอร์โทรก่อน
          </p>
        ) : null}
        {busyReason === "bridge" ? (
          <p className="muted" style={{ marginBottom: "0.75rem", textAlign: "left", fontSize: "0.85rem" }}>
            กำลังยืนยันสิทธิ์จาก Google — ถ้าค้างนาน กดลองใหม่ด้านล่าง
          </p>
        ) : null}
        {busyReason === "staff" ? (
          <p className="muted" style={{ marginBottom: "0.75rem", textAlign: "left", fontSize: "0.85rem" }}>
            กำลังตรวจสิทธิ์พนักงาน...
          </p>
        ) : null}
        {showEscape ? (
          <div style={{ marginBottom: "0.75rem", textAlign: "left" }}>
            <p className="error-text" style={{ marginBottom: "0.5rem" }}>
              ล็อกอินค้างนานผิดปกติ — ลองใหม่หรือออกจากระบบแล้วเข้าอีกครั้ง
            </p>
            <div className="btn-row">
              <button
                type="button"
                className="ghost-btn"
                onClick={() => {
                  window.location.assign("/login/");
                }}
              >
                รีเฟรชหน้าเข้าสู่ระบบ
              </button>
              <button type="button" className="ghost-btn" onClick={() => void signOut()}>
                ออกแล้วลองใหม่
              </button>
            </div>
          </div>
        ) : null}

        <p className="muted" style={{ marginBottom: "0.75rem", textAlign: "left", fontSize: "0.85rem" }}>
          เลือกวิธีที่สะดวก — อีเมลต้องเป็น Google ที่เจ้าของเพิ่มไว้แล้ว · เบอร์โทรยืนยันด้วย OTP
          <br />
          เปิดใน Chrome หรือ Safari (อย่าเปิดจาก LINE) · ถ้าเด้้อกลับมาหน้านี้ ให้กดเข้าสู่ระบบซ้ำได้
        </p>

        <div className="login-mode-tabs" role="tablist" aria-label="วิธีเข้าสู่ระบบ">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "google"}
            className={cn("login-mode-tab", mode === "google" && "active")}
            onClick={() => {
              setMode("google");
              setLocalError(null);
            }}
          >
            Google
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "phone"}
            className={cn("login-mode-tab", mode === "phone" && "active")}
            onClick={() => {
              setMode("phone");
              setLocalError(null);
            }}
          >
            เบอร์โทร
          </button>
        </div>

        {mode === "google" ? (
          <button
            type="button"
            className="primary-btn"
            onClick={() => void signIn()}
            disabled={blocked || signingIn}
          >
            {signingIn ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบด้วย Google"}
          </button>
        ) : (
          <div className="login-phone-panel">
            <div id="phone-recaptcha" />
            {!otpSent ? (
              <form className="entry-form" onSubmit={(e) => void onSendOtp(e)}>
                <div className="field">
                  <label htmlFor="login-phone">เบอร์โทรศัพท์</label>
                  <input
                    id="login-phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="0812345678"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                  />
                </div>
                <button type="submit" className="primary-btn" disabled={blocked || busy || signingIn}>
                  {busy ? "กำลังส่ง..." : "ส่งรหัส OTP"}
                </button>
              </form>
            ) : (
              <form className="entry-form" onSubmit={(e) => void onConfirmOtp(e)}>
                <p className="muted" style={{ textAlign: "left", margin: "0 0 0.65rem" }}>
                  ส่งรหัสไปที่ {phone} แล้ว
                </p>
                <div className="field">
                  <label htmlFor="login-otp">รหัส OTP</label>
                  <input
                    id="login-otp"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    required
                  />
                </div>
                <div className="btn-row">
                  <button type="submit" className="primary-btn" disabled={blocked || busy || signingIn}>
                    {busy ? "กำลังยืนยัน..." : "ยืนยันและเข้าใช้"}
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={busy}
                    onClick={() => {
                      setOtpSent(false);
                      setOtp("");
                      setLocalError(null);
                    }}
                  >
                    เปลี่ยนเบอร์
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
