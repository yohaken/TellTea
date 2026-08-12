"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";

/** ตั้งค่าแจ้งเตือนย้ายไป /settings/ หมวดแจ้งเตือนเจ้าของ */
export default function AlertsPage() {
  return (
    <AuthGate>
      <AlertsRedirect />
    </AuthGate>
  );
}

function AlertsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/settings/");
  }, [router]);
  return (
    <div className="center-screen">
      <p className="muted">กำลังพาไปตั้งค่าแจ้งเตือน...</p>
    </div>
  );
}
