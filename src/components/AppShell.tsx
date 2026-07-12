"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Boxes,
  ChefHat,
  CircleDollarSign,
  ClipboardCheck,
  ClipboardList,
  Coffee,
  LogOut,
  MoreHorizontal,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { AppBrand } from "@/components/AppBrand";
import { LowBalanceAlert } from "@/components/LowBalanceAlert";
import { PersonalProfileModal } from "@/components/PersonalProfileModal";
import { ProfilePromptBanner } from "@/components/ProfilePromptBanner";
import { UiSettingsProvider } from "@/components/UiSettingsProvider";
import { profileStatusLabel } from "@/lib/profile";
import { can, hasAnyExtraPermission } from "@/lib/permissions";
import { cn } from "@/lib/utils";

const MORE_PREFIXES = [
  "/more",
  "/settings",
  "/bonus",
  "/pnl",
  "/owner-books",
  "/alerts",
  "/in",
  "/export",
  "/staff",
  "/profile",
  "/tasks",
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { staff, user, signOut } = useAuth();
  const isOwner = staff?.role === "owner";
  const emailShort = user?.email?.split("@")[0] || user?.phoneNumber?.slice(-4) || "";
  const userLabel = profileStatusLabel(staff) || emailShort;
  const roleLabel = isOwner ? "เจ้าของ" : "พนักงาน";

  const links = [
    can(staff, "ledger")
      ? { href: "/ledger/", label: "บัญชี", icon: BookOpen }
      : null,
    can(staff, "production")
      ? { href: "/production/", label: "ผลิต", icon: ChefHat }
      : null,
    can(staff, "otBonus")
      ? { href: "/ot/", label: "ชง", icon: Coffee }
      : null,
    can(staff, "bonus")
      ? { href: "/bonus/", label: "โบนัส", icon: CircleDollarSign }
      : null,
    can(staff, "checklist")
      ? { href: "/check/", label: "เช็ค", icon: ClipboardCheck }
      : null,
    can(staff, "stock")
      ? { href: "/stock/", label: "คลัง", icon: Boxes }
      : null,
    can(staff, "assignTasks")
      ? { href: "/tasks/", label: "งาน", icon: ClipboardList }
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
            {staff?.role === "staff" ? (
              <Link
                href="/profile/"
                className="topbar-email topbar-email-link"
                title={user?.email || user?.phoneNumber || "โปรไฟล์พนักงาน"}
              >
                {userLabel}
              </Link>
            ) : (
              <span className="topbar-email" title={user?.email || user?.phoneNumber || ""}>
                {userLabel}
              </span>
            )}
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

        <main className="main-panel">
          <ProfilePromptBanner />
          {children}
        </main>

        <LowBalanceAlert />

        <PersonalProfileModal />

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
