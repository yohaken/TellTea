"use client";

import Link from "next/link";

/** สลับโหมดในบัญชี: เข้า–ออก ↔ เทียบเงินนำเข้า (เงินสดหน้าร้านโอนเข้า บช. ร้าน) */
export function LedgerModeSwitch({
  active,
}: {
  active: "ledger" | "cash-in";
}) {
  return (
    <nav className="owner-books-mode ledger-mode-switch" aria-label="โหมดบัญชี">
      <Link
        href="/ledger/"
        className={
          active === "ledger"
            ? "owner-books-mode-btn is-active"
            : "owner-books-mode-btn"
        }
        aria-current={active === "ledger" ? "page" : undefined}
      >
        เข้า–ออก
      </Link>
      <Link
        href="/ledger/cash-in/"
        className={
          active === "cash-in"
            ? "owner-books-mode-btn is-active"
            : "owner-books-mode-btn"
        }
        aria-current={active === "cash-in" ? "page" : undefined}
      >
        เทียบเงินนำเข้า
      </Link>
    </nav>
  );
}
