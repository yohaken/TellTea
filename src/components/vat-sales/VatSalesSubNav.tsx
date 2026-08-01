"use client";

import Link from "next/link";

/** สลับหน้าใต้ VAT: งบเดือน ↔ แหล่งนำเข้า (พรีวิว) */
export function VatSalesSubNav({
  active,
}: {
  active: "month" | "sources";
}) {
  return (
    <nav className="vat-sales-tabs" role="tablist" aria-label="VAT">
      <Link
        href="/vat-sales/"
        role="tab"
        aria-selected={active === "month"}
        className={
          active === "month" ? "vat-sales-tab is-active" : "vat-sales-tab"
        }
      >
        VAT เดือน
      </Link>
      <Link
        href="/vat-sales/sources/"
        role="tab"
        aria-selected={active === "sources"}
        className={
          active === "sources" ? "vat-sales-tab is-active" : "vat-sales-tab"
        }
      >
        แหล่งนำเข้า
      </Link>
    </nav>
  );
}
