"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";

/** หน้าแจ้งเตือนยอดต่ำถูกลบแล้ว — รีไดเรกต์ */
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
    router.replace("/more/");
  }, [router]);
  return (
    <div className="center-screen">
      <p className="muted">กำลังพาไปอื่นๆ...</p>
    </div>
  );
}
