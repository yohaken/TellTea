"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { AppBrand } from "./AppBrand";
import { AppShell } from "./AppShell";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { status, error, signIn, signOut, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "signedOut" || status === "unconfigured") {
      router.replace("/login/");
    }
  }, [status, router]);

  if (status === "loading") {
    return (
      <div className="center-screen">
        <AppBrand />
        <p className="muted">กำลังตรวจสอบสิทธิ์...</p>
      </div>
    );
  }

  if (status === "denied") {
    return (
      <div className="center-screen">
        <AppBrand />
        <h1>ยังไม่มีสิทธิ์เข้าใช้งาน</h1>
        <p className="muted">
          บัญชี <strong>{user?.email || user?.phoneNumber || "นี้"}</strong> ยังไม่อยู่ในรายชื่อพนักงาน
          ให้เจ้าของร้านเพิ่มอีเมลหรือเบอร์โทรในหน้าพนักงาน
        </p>
        {error ? (
          <p className="error-text">
            {error}
            <br />
            <span className="muted" style={{ display: "inline-block", marginTop: "0.35rem" }}>
              ลองออกจากระบบแล้วเข้าใหม่ — ถ้ายังไม่ได้ ให้เจ้าของเช็คว่าบัญชีนี้อยู่ในรายชื่อและเปิดสิทธิ์แล้ว
            </span>
          </p>
        ) : null}
        <div className="btn-row">
          <button type="button" className="primary-btn" onClick={() => void signOut()}>
            ออกจากระบบ
          </button>
          <button type="button" className="ghost-btn" onClick={() => void signIn()}>
            ลองบัญชีอื่น
          </button>
        </div>
      </div>
    );
  }

  if (status !== "ready") {
    return null;
  }

  return <AppShell>{children}</AppShell>;
}
