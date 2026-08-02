"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
import { PermPreviewBanner } from "@/components/PermPreviewBanner";
import { PersonalProfileModal } from "@/components/PersonalProfileModal";
import { ProfilePromptBanner } from "@/components/ProfilePromptBanner";
import { StaffNewsPopup } from "@/components/StaffNewsPopup";
import { StaffTaskNudge } from "@/components/StaffTaskNudge";
import { OwnerQuickDock } from "@/components/OwnerQuickDock";
import { StaffPresenceDock } from "@/components/StaffPresenceDock";
import { StaffPresenceHeartbeat } from "@/components/StaffPresenceHeartbeat";
import { StaffUtilityDock } from "@/components/StaffUtilityDock";
import { staffHomeHref } from "@/lib/nav-menu";
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
  "/pos-sales",
  "/vat-sales",
  "/menu",
  "/in",
  "/export",
  "/staff",
  "/profile",
  "/tasks",
  "/utility",
  "/business-notes",
  "/capital",
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
  const router = useRouter();
  const { staff, realStaff, user, signOut, isPermPreview, permPreview } = useAuth();
  const realIsOwner = realStaff?.role === "owner";
  const isOwner = realIsOwner && !isPermPreview;
  const emailShort = user?.email?.split("@")[0] || user?.phoneNumber?.slice(-4) || "";
  const userLabel = isPermPreview
    ? permPreview?.label || "พรีวิว"
    : profileStatusLabel(realStaff) || emailShort;
  const roleLabel = isPermPreview ? "พรีวิวพนักงาน" : isOwner ? "เจ้าของ" : "พนักงาน";
  const [navUi, setNavUi] = useState<NavUiSettings>(DEFAULT_UI);

  useEffect(() => {
    return subscribeNavUi(setNavUi);
  }, []);

  useEffect(() => {
    if (!isPermPreview || !staff) return;
    const home = staffHomeHref(staff);
    const onStaffHub = pathname.startsWith("/staff");
    const onOwnerOnly =
      pathname.startsWith("/vat-sales") ||
      pathname.startsWith("/menu") ||
      pathname.startsWith("/settings") ||
      pathname.startsWith("/pos-sales") ||
      pathname.startsWith("/business-notes");
    if (onStaffHub || onOwnerOnly) {
      router.replace(home);
    }
  }, [isPermPreview, staff, pathname, router]);

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
            {!isPermPreview && staff?.role === "staff" ? (
              <Link
                href="/profile/"
                className="topbar-email topbar-email-link"
                title={user?.email || user?.phoneNumber || "โปรไฟล์พนักงาน"}
              >
                {userLabel}
              </Link>
            ) : (
              <span
                className={`topbar-email${isOwner ? " topbar-email--owner-slim" : ""}`}
                title={user?.email || user?.phoneNumber || ""}
              >
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

        <PermPreviewBanner />

        {/* โชว์ตลอดเมื่อเป็นเจ้าของจริง — รวมตอนพรีวิว เพื่อแตะไอคอนเดิมแล้วออก */}
        {realIsOwner ? <StaffPresenceDock /> : null}
        {!isPermPreview ? <StaffPresenceHeartbeat /> : null}

        <main className="main-panel">
          {/* พรีวิวไม่โชว์แบนเนอร์/โมดอลโปรไฟล์จริง — กันแก้บัญชีเจ้าของโดยไม่ตั้งใจ */}
          {!isPermPreview ? <ProfilePromptBanner /> : null}
          {children}
        </main>

        {/* มุมพนักงานเป๊ะตอนพรีวิว: ข่าว · แจ้งงานเบา/หนัก · ยูทิล · เตือนยอดต่ำ */}
        <StaffNewsPopup />
        <StaffTaskNudge />
        <LowBalanceAlert />

        {!isPermPreview ? <PersonalProfileModal /> : null}

        {isOwner ? <OwnerQuickDock /> : null}
        <StaffUtilityDock />

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
