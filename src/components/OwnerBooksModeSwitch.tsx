"use client";

import Link from "next/link";

/** สลับโหมดในบช.เจ้าของ: เงินออก ↔ ยอดขาย/VAT (เฉพาะเจ้าของ) */
export function OwnerBooksModeSwitch({
  active,
}: {
  active: "out" | "vat";
}) {
  return (
    <nav className="owner-books-mode" aria-label="โหมดบช.เจ้าของ">
      <Link
        href="/owner-books/"
        className={
          active === "out"
            ? "owner-books-mode-btn is-active"
            : "owner-books-mode-btn"
        }
        aria-current={active === "out" ? "page" : undefined}
      >
        เงินออก
      </Link>
      <Link
        href="/vat-sales/"
        className={
          active === "vat"
            ? "owner-books-mode-btn is-active"
            : "owner-books-mode-btn"
        }
        aria-current={active === "vat" ? "page" : undefined}
      >
        VAT เดือน
      </Link>
    </nav>
  );
}
