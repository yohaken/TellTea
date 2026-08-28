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

type LoginMode = "email" | "google";

export default function LoginPage() {
  const {
    status,
    busyReason,
    staff,
    signIn,
    signInWithStaffEmailPassword,
    signOut,
    error,
  } = useAuth();
  const router = useRouter();
  const [inApp, setInApp] = useState(false);
  const [mode, setMode] = useState<LoginMode>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [showEscape, setShowEscape] = useState(false);

  useEffect(() => {
    setInApp(isInAppBrowser());
  }, []);

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

  async function onEmailLogin(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setLocalError(null);
    try {
      await signInWithStaffEmailPassword(email, password);
    } catch (err) {
      setLocalError((err as Error).message || "เข้าสู่ระบบไม่สำเร็จ");
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
            บัญชีที่เข้าอยู่ยังไม่ตรงรายชื่อร้าน — เจ้าของใช้ Google{" "}
            <strong>yohaken@gmail.com</strong>
            · พนักงานใช้อีเมลที่ลงทะเบียน + รหัสผ่าน = เบอร์โทร 10 หลัก
          </p>
        ) : null}
        {busyReason === "bridge" ? (
          <p className="muted" style={{ marginBottom: "0.75rem", textAlign: "left", fontSize: "0.85rem" }}>
            กำลังยืนยันสิทธิ์ — ถ้าค้างนาน กดลองใหม่ด้านล่าง
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
          <strong>พนักงาน:</strong> อีเมลที่ลงทะเบียน + รหัสผ่าน = เบอร์โทร 10 หลัก (เช่น 0985081617)
          <br />
          <strong>เจ้าของ:</strong> Google · เปิดใน Chrome/Safari
        </p>

        <div className="login-mode-tabs" role="tablist" aria-label="วิธีเข้าสู่ระบบ">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "email"}
            className={cn("login-mode-tab", mode === "email" && "active")}
            onClick={() => {
              setMode("email");
              setLocalError(null);
            }}
          >
            อีเมล
          </button>
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
        </div>

        {mode === "email" ? (
          <form className="entry-form login-phone-panel" onSubmit={(e) => void onEmailLogin(e)}>
            <div className="field">
              <label htmlFor="login-email">อีเมล</label>
              <input
                id="login-email"
                type="email"
                inputMode="email"
                autoComplete="username email"
                placeholder="name@gmail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="login-password">รหัสผ่าน (เบอร์โทร 10 หลัก)</label>
              <input
                id="login-password"
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                placeholder="0985081617"
                value={password}
                onChange={(e) => setPassword(e.target.value.replace(/\D/g, "").slice(0, 10))}
                minLength={10}
                maxLength={10}
                required
              />
            </div>
            <button type="submit" className="primary-btn" disabled={blocked || busy || signingIn}>
              {busy || signingIn ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="primary-btn"
            onClick={() => void signIn()}
            disabled={blocked || signingIn}
          >
            {signingIn ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบด้วย Google"}
          </button>
        )}
      </div>
    </div>
  );
}
