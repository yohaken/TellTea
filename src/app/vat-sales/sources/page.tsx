"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { OwnerBooksModeSwitch } from "@/components/OwnerBooksModeSwitch";
import { VatDeliverySources } from "@/components/vat-sales/VatDeliverySources";
import { VatSalesSubNav } from "@/components/vat-sales/VatSalesSubNav";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/permissions";

export default function VatDeliverySourcesPage() {
  return (
    <AuthGate>
      <VatDeliverySourcesGate />
    </AuthGate>
  );
}

function VatDeliverySourcesGate() {
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
      <VatSalesSubNav active="sources" />
      <VatDeliverySources actor={actor} />
    </div>
  );
}
