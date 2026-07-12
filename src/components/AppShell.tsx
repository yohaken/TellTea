"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Boxes,
  ChefHat,
  CircleDollarSign,
  ClipboardCheck,
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
import {
  DEFAULT_NAV_ORDER,
  sortByNavOrder,
  subscribeNavOrder,
  type NavTabKey,
} from "@/lib/nav-menu";
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

const NAV_ICONS = {
  ledger: BookOpen,
  production: ChefHat,
  otBonus: Coffee,
  bonus: CircleDollarSign,
  checklist: ClipboardCheck,
  stock: Boxes,
  more: MoreHorizontal,
} as const;

const NAV_HREFS: Record<NavTabKey, string> = {
  ledger: "/ledger/",
  production: "/production/",
  otBonus: "/ot/",
  bonus: "/bonus/",
  checklist: "/check/",
  stock: "/stock/",
  more: "/more/",
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { staff, user, signOut } = useAuth();
  const isOwner = staff?.role === "owner";
  const emailShort = user?.email?.split("@")[0] || user?.phoneNumber?.slice(-4) || "";
  const userLabel = profileStatusLabel(staff) || emailShort;
  const roleLabel = isOwner ? "เจ้าของ" : "พนักงาน";
  const [navOrder, setNavOrder] = useState<NavTabKey[]>([...DEFAULT_NAV_ORDER]);

  useEffect(() => {
    return subscribeNavOrder(setNavOrder);
  }, []);

  const links = useMemo(() => {
    const visible: { key: NavTabKey; href: string; label: string; icon: typeof BookOpen }[] = [];

    if (can(staff, "ledger")) {
      visible.push({ key: "ledger", href: NAV_HREFS.ledger, label: "บัญชี", icon: NAV_ICONS.ledger });
    }
    if (can(staff, "production")) {
      visible.push({
        key: "production",
        href: NAV_HREFS.production,
        label: "ผลิต",
        icon: NAV_ICONS.production,
      });
    }
    if (can(staff, "otBonus")) {
      visible.push({ key: "otBonus", href: NAV_HREFS.otBonus, label: "ชง", icon: NAV_ICONS.otBonus });
    }
    if (can(staff, "bonus")) {
      visible.push({ key: "bonus", href: NAV_HREFS.bonus, label: "โบนัส", icon: NAV_ICONS.bonus });
    }
    if (can(staff, "checklist")) {
      visible.push({
        key: "checklist",
        href: NAV_HREFS.checklist,
        label: "เช็ค",
        icon: NAV_ICONS.checklist,
      });
    }
    if (can(staff, "stock")) {
      visible.push({ key: "stock", href: NAV_HREFS.stock, label: "คลัง", icon: NAV_ICONS.stock });
    }
    if (hasAnyExtraPermission(staff)) {
      visible.push({ key: "more", href: NAV_HREFS.more, label: "อื่นๆ", icon: NAV_ICONS.more });
    }

    return sortByNavOrder(visible, navOrder);
  }, [staff, navOrder]);

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
