"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { OwnerBooksModeSwitch } from "@/components/OwnerBooksModeSwitch";
import { VatAgentChatPopup } from "@/components/vat-sales/VatAgentChatPopup";
import { VatMonthBooks } from "@/components/vat-sales/VatMonthBooks";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { bangkokMonthKey } from "@/lib/vat-sales";

export default function VatSalesPage() {
  return (
    <AuthGate>
      <VatSalesGate />
    </AuthGate>
  );
}

function VatSalesGate() {
  const { staff } = useAuth();
  const router = useRouter();
  const isOwner = staff?.role === "owner";
  const actor = staff?.id || staff?.email || "owner";

  useEffect(() => {
    if (staff && !isOwner) {
      router.replace(can(staff, "ownerBooks") ? "/owner-books/" : "/more/");
    }
  }, [staff, isOwner, router]);

  if (!isOwner) return null;
  return (
    <div className="vat-sales-page vat-sales-page--compact owner-books-page">
      <OwnerBooksModeSwitch active="vat" />
      <VatMonthBooks actor={actor} />
      <VatAgentChatPopup actor={actor} monthKey={bangkokMonthKey()} />
    </div>
  );
}
