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
import {
  DEFAULT_NAV_ORDER,
  DEFAULT_DOCK_TAB_MAX,
  NAV_MODULE_HREFS,
  NAV_TAB_LABELS,
  resolveNavForUser,
  subscribeNavUi,
  type NavModuleKey,
  type NavTabKey,
  type NavUiSettings,
} from "@/lib/nav-menu";
import { profileStatusLabel } from "@/lib/profile";
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

const NAV_ICONS: Record<NavTabKey, typeof BookOpen> = {
  ledger: BookOpen,
  production: ChefHat,
  otBonus: Coffee,
  bonus: CircleDollarSign,
  checklist: ClipboardCheck,
  stock: Boxes,
  assignTasks: ClipboardList,
  more: MoreHorizontal,
};

const DEFAULT_UI: NavUiSettings = {
  navOrder: [...DEFAULT_NAV_ORDER],
  dockTabKeys: [],
  dockTabMax: DEFAULT_DOCK_TAB_MAX,
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { staff, user, signOut } = useAuth();
  const isOwner = staff?.role === "owner";
  const emailShort = user?.email?.split("@")[0] || user?.phoneNumber?.slice(-4) || "";
  const userLabel = profileStatusLabel(staff) || emailShort;
  const roleLabel = isOwner ? "เจ้าของ" : "พนักงาน";
  const [navUi, setNavUi] = useState<NavUiSettings>(DEFAULT_UI);

  useEffect(() => {
    return subscribeNavUi(setNavUi);
  }, []);

  const links = useMemo(() => {
    const { dockModules, showMoreTab } = resolveNavForUser(staff, navUi);
    const items: {
      key: NavTabKey;
      href: string;
      label: string;
      icon: (typeof NAV_ICONS)[NavTabKey];
    }[] = dockModules.map(({ key, href, label }) => ({
      key,
      href,
      label,
      icon: NAV_ICONS[key],
    }));

    if (showMoreTab) {
      items.push({
        key: "more",
        href: "/more/",
        label: NAV_TAB_LABELS.more,
        icon: NAV_ICONS.more,
      });
    }

    return items;
  }, [staff, navUi]);

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

        <nav
          className={cn(
            "bottom-nav",
            links.length >= 7 && "bottom-nav--compact",
            links.length >= 5 && links.length < 7 && "bottom-nav--dense",
          )}
          style={{ gridTemplateColumns: `repeat(${links.length}, minmax(0, 1fr))` }}
        >
          {links.map(({ key, href, label, icon: Icon }) => {
            const iconSize = links.length >= 7 ? 18 : links.length >= 5 ? 20 : 22;
            const active =
              pathname === href ||
              pathname.startsWith(href.replace(/\/$/, "")) ||
              (href === "/more/" && MORE_PREFIXES.some((p) => pathname.startsWith(p))) ||
              (key !== "more" && pathname.startsWith(NAV_MODULE_HREFS[key as NavModuleKey]?.replace(/\/$/, "") || ""));
            return (
              <Link key={href} href={href} className={cn("nav-item", active && "active")}>
                <Icon size={iconSize} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
