"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

export default function HomePage() {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "ready") router.replace("/pos/");
    else if (status === "signedOut" || status === "unconfigured" || status === "denied") {
      router.replace("/login/");
    }
  }, [status, router]);

  return (
    <div className="center-screen">
      <p className="brand">TellTea</p>
      <p className="muted">กำลังเปิดร้าน...</p>
    </div>
  );
}
