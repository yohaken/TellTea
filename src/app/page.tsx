"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { AppBrand } from "@/components/AppBrand";

export default function HomePage() {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "ready") {
      router.replace("/ledger/");
      return;
    }
    if (status === "signedOut" || status === "unconfigured" || status === "denied") {
      router.replace("/login/");
    }
  }, [status, router]);

  useEffect(() => {
    if (status !== "loading") return;
    const timer = window.setTimeout(() => {
      router.replace("/login/");
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [status, router]);

  return (
    <div className="center-screen">
      <AppBrand />
      <p className="muted">กำลังเปิดบัญชีร้าน...</p>
    </div>
  );
}
