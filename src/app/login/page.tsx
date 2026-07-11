"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const { status, signIn, error } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "ready") router.replace("/ledger/");
  }, [status, router]);

  return (
    <div className="hero-login">
      <div className="hero-copy">
        <p className="brand">TellTea</p>
        <p>บัญชีร้าน — เจ้าของโอนเข้า พนักงานบันทึกเงินออก</p>
      </div>
      <div className="hero-actions">
        {status === "unconfigured" ? (
          <p className="error-text">
            ยังไม่ได้ตั้งค่า Firebase — คัดลอก `.env.example` เป็น `.env.local` แล้วใส่ค่าจาก Firebase Console
          </p>
        ) : null}
        {error ? <p className="error-text">{error}</p> : null}
        {status === "denied" ? (
          <p className="muted" style={{ marginBottom: "0.75rem" }}>
            บัญชีนี้ยังไม่อยู่ในรายชื่อพนักงาน ให้เจ้าของเพิ่มอีเมลก่อน
          </p>
        ) : null}
        <button
          type="button"
          className="primary-btn"
          onClick={() => void signIn()}
          disabled={status === "loading" || status === "unconfigured"}
        >
          เข้าสู่ระบบด้วย Google
        </button>
      </div>
    </div>
  );
}
