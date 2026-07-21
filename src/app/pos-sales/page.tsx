"use client";

import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { PosSalesReportPage } from "@/components/PosSalesReport";
import { useAuth } from "@/lib/auth";

export default function PosSalesPage() {
  return (
    <AuthGate>
      <Suspense
        fallback={
          <div className="center-screen">
            <p className="muted">กำลังโหลด POS...</p>
          </div>
        }
      >
        <PosSalesGate />
      </Suspense>
    </AuthGate>
  );
}

function PosSalesGate() {
  const { staff } = useAuth();
  const router = useRouter();
  const isOwner = staff?.role === "owner";

  useEffect(() => {
    if (staff && !isOwner) router.replace("/more/");
  }, [staff, isOwner, router]);

  if (!isOwner) return null;
  return <PosSalesReportPage />;
}
