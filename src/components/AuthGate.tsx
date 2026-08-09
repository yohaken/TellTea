"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AUTH_LOADING_ESCAPE_MS, useAuth } from "@/lib/auth";
import { AppBrand } from "./AppBrand";
import { AppShell } from "./AppShell";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { status, busyReason, error, signIn, signOut, user } = useAuth();
  const router = useRouter();
  const [showEscape, setShowEscape] = useState(false);

  useEffect(() => {
    if (status === "signedOut" || status === "unconfigured") {
      router.replace("/login/");
    }
  }, [status, router]);

  useEffect(() => {
    if (status !== "loading") {
      setShowEscape(false);
      return;
    }
    const timer = window.setTimeout(() => setShowEscape(true), AUTH_LOADING_ESCAPE_MS);
    return () => window.clearTimeout(timer);
  }, [status]);

  if (status === "loading") {
    const hint =
      busyReason === "bridge"
        ? "กำลังยืนยันสิทธิ์จาก Google..."
        : busyReason === "staff"
          ? "กำลังตรวจสิทธิ์พนักงาน..."
          : "กำลังตรวจสอบสิทธิ์...";
    return (
      <div className="center-screen">
        <AppBrand />
        <p className="muted">{hint}</p>
        {error ? <p className="error-text">{error}</p> : null}
        {showEscape ? (
          <>
            <p className="error-text">ค้างนานผิดปกติ — ลองใหม่อีกครั้ง</p>
            <div className="btn-row">
              <button
                type="button"
                className="primary-btn"
                onClick={() => {
                  window.location.assign("/login/");
                }}
              >
                ไปหน้าเข้าสู่ระบบ
              </button>
              <button type="button" className="ghost-btn" onClick={() => void signOut()}>
                ออกจากระบบ
              </button>
            </div>
          </>
        ) : null}
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
