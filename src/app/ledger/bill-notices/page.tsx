"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Deep-link → open ตารางแจ้งบิล panel on /ledger/ */
export default function LedgerBillNoticesRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/ledger/?billNotice=1");
  }, [router]);
  return (
    <div className="center-screen">
      <p className="muted">กำลังเปิดตารางแจ้งบิล…</p>
    </div>
  );
}
