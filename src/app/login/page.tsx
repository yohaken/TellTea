"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

function isInAppBrowser() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /Line\//i.test(ua) || /FBAN|FBAV/i.test(ua) || /Instagram/i.test(ua);
}

export default function LoginPage() {
  const { status, signIn, error } = useAuth();
  const router = useRouter();
  const [inApp, setInApp] = useState(false);

  useEffect(() => {
    setInApp(isInAppBrowser());
  }, []);

  useEffect(() => {
    if (status === "ready") router.replace("/ledger/");
  }, [status, router]);

  const blocked = status === "unconfigured";

  return (
    <div className="hero-login">
      <div className="hero-copy">
        <p className="brand">TellTea</p>
        <p>บัญชีร้าน — เจ้าของโอนเข้า พนักงานบันทึกเงินออก</p>
      </div>
      <div className="hero-actions">
        {inApp ? (
          <p className="error-text" style={{ marginBottom: "0.75rem" }}>
            เปิดจาก LINE/แชทมักโดนบล็อก Google — กด ⋯ แล้วเลือก “เปิดในเบราว์เซอร์”
            (Safari หรือ Chrome)
          </p>
        ) : null}
        {status === "unconfigured" ? (
          <p className="error-text">
            ยังไม่ได้ตั้งค่า Firebase — คัดลอก `.env.example` เป็น `.env.local` แล้วใส่ค่าจาก Firebase Console
          </p>
        ) : null}
        {error ? <p className="error-text">{error}</p> : null}
        {status === "denied" ? (
          <p className="muted" style={{ marginBottom: "0.75rem", textAlign: "left" }}>
            บัญชีนี้ยังไม่อยู่ในรายชื่อพนักงาน ให้เจ้าของเพิ่มอีเมลก่อน
          </p>
        ) : null}
        <button
          type="button"
          className="primary-btn"
          onClick={() => void signIn()}
          disabled={blocked}
        >
          {status === "loading" ? "กำลังเตรียมระบบ..." : "เข้าสู่ระบบด้วย Google"}
        </button>
      </div>
    </div>
  );
}
