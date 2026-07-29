"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";

/** Legacy URL — cash-in table now lives collapsed at the top of /ledger/. */
export default function CashInRedirectPage() {
  return (
    <AuthGate>
      <CashInRedirect />
    </AuthGate>
  );
}

function CashInRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/ledger/?cashIn=1");
  }, [router]);
  return (
    <div className="center-screen">
      <p className="muted">กำลังเปิดตารางเทียบเงินนำเข้า…</p>
    </div>
  );
}
