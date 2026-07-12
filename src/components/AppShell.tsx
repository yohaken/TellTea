"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Boxes,
  ChefHat,
  LogOut,
  MoreHorizontal,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { AppBrand } from "@/components/AppBrand";
import { LowBalanceAlert } from "@/components/LowBalanceAlert";
import { UiSettingsProvider } from "@/components/UiSettingsProvider";
import { can, hasAnyExtraPermission } from "@/lib/permissions";
import { cn } from "@/lib/utils";

const MORE_PREFIXES = [
  "/more",
  "/pnl",
  "/owner-books",
  "/alerts",
  "/in",
  "/export",
  "/staff",
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { staff, user, signOut } = useAuth();
  const isOwner = staff?.role === "owner";
  const emailShort = user?.email?.split("@")[0] || "";
  const roleLabel = isOwner ? "เจ้าของ" : "พนักงาน";

  const links = [
    can(staff, "ledger")
      ? { href: "/ledger/", label: "บัญชี", icon: BookOpen }
      : null,
    can(staff, "production")
      ? { href: "/production/", label: "ผลิต", icon: ChefHat }
      : null,
    can(staff, "stock")
      ? { href: "/stock/", label: "สต็อก", icon: Boxes }
      : null,
    hasAnyExtraPermission(staff)
      ? { href: "/more/", label: "อื่นๆ", icon: MoreHorizontal }
      : null,
  ].filter(Boolean) as { href: string; label: string; icon: typeof BookOpen }[];

  return (
    <div className="phone-frame">
      <div className="app-shell">
        <header className="topbar">
          <div>
            <AppBrand compact />
            <p className="topbar-sub">{roleLabel}</p>
          </div>
          <div className="topbar-user">
            <span className="topbar-email" title={user?.email || ""}>
              {emailShort}
            </span>
            <button
              type="button"
              className="ghost-btn icon-btn"
              onClick={() => void signOut()}
              aria-label="ออกจากระบบ"
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>

        <main className="main-panel">{children}</main>

        <LowBalanceAlert />

        <UiSettingsProvider />

        <nav className="bottom-nav">
          {links.map(({ href, label, icon: Icon }) => {
            const active =
              pathname === href ||
              pathname.startsWith(href.replace(/\/$/, "")) ||
              (href === "/more/" &&
                MORE_PREFIXES.some((p) => pathname.startsWith(p)));
            return (
              <Link key={href} href={href} className={cn("nav-item", active && "active")}>
                <Icon size={22} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
