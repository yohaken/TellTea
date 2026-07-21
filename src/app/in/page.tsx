"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";

/** โอนเข้าย้ายไปบัญชีแล้ว — redirect เปิดฟอร์มบน /ledger/ */
export default function TransferInPage() {
  return (
    <AuthGate>
      <TransferInRedirect />
    </AuthGate>
  );
}

function TransferInRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/ledger/?transferIn=1");
  }, [router]);
  return (
    <div className="center-screen">
      <p className="muted">กำลังเปิดโอนเข้าในบัญชี...</p>
    </div>
  );
}
