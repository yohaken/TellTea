"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { OwnerBooksModeSwitch } from "@/components/OwnerBooksModeSwitch";
import { VatImportWorkbench } from "@/components/vat-sales/VatImportWorkbench";
import { VatMonthlyWorkbench } from "@/components/vat-sales/VatMonthlyWorkbench";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/permissions";

type VatSalesTab = "month" | "import";

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
  const [tab, setTab] = useState<VatSalesTab>("month");
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
      <div className="vat-sales-tabs" role="tablist" aria-label="VAT">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "month"}
          className={tab === "month" ? "vat-sales-tab is-active" : "vat-sales-tab"}
          onClick={() => setTab("month")}
        >
          เดือน
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "import"}
          className={
            tab === "import" ? "vat-sales-tab is-active" : "vat-sales-tab"
          }
          onClick={() => setTab("import")}
        >
          นำเข้า
        </button>
      </div>
      {tab === "month" ? (
        <VatMonthlyWorkbench actor={actor} />
      ) : (
        <VatImportWorkbench actor={actor} />
      )}
    </div>
  );
}
