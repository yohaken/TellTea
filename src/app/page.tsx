"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AUTH_LOADING_ESCAPE_MS, AUTH_STAFF_RESOLVE_TIMEOUT_MS, useAuth } from "@/lib/auth";
import { AppBrand } from "@/components/AppBrand";
import { staffHomeHref } from "@/lib/nav-menu";

export default function HomePage() {
  const { status, staff } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "ready") {
      // ตามสิทธิ์ effective (รวมพรีวิว) — ไม่บังคับ /ledger เสมอ
      router.replace(staffHomeHref(staff));
      return;
    }
    if (status === "signedOut" || status === "unconfigured" || status === "denied") {
      router.replace("/login/");
    }
  }, [status, staff, router]);

  useEffect(() => {
    // อย่าเด้ง /login กลางคันตอน resolveStaff ยังไม่จบ (timeout จริง ~12s)
    if (status !== "loading") return;
    const timer = window.setTimeout(() => {
      router.replace("/login/");
    }, AUTH_STAFF_RESOLVE_TIMEOUT_MS + AUTH_LOADING_ESCAPE_MS);
    return () => window.clearTimeout(timer);
  }, [status, router]);

  return (
    <div className="center-screen">
      <AppBrand />
      <p className="muted">กำลังเปิดบัญชีร้าน...</p>
    </div>
  );
}
