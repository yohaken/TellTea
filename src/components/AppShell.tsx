"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CupSoda, LayoutGrid, LogOut, Users, Wallet } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

const links = [
  { href: "/pos/", label: "ขาย", icon: CupSoda },
  { href: "/menu/", label: "เมนู", icon: LayoutGrid },
  { href: "/today/", label: "วันนี้", icon: Wallet },
  { href: "/staff/", label: "พนักงาน", icon: Users, ownerOnly: true },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { staff, user, signOut } = useAuth();
  const isOwner = staff?.role === "owner";
  const emailShort = user?.email?.split("@")[0] || "";

  return (
    <div className="phone-frame">
      <div className="app-shell">
        <header className="topbar">
          <div>
            <p className="brand">TellTea</p>
            <p className="topbar-sub">จัดการร้าน</p>
          </div>
          <div className="topbar-user">
            <span className="topbar-email" title={user?.email || ""}>
              {emailShort}
            </span>
            <button type="button" className="ghost-btn icon-btn" onClick={() => void signOut()} aria-label="ออกจากระบบ">
              <LogOut size={18} />
            </button>
          </div>
        </header>

        <main className="main-panel">{children}</main>

        <nav className="bottom-nav">
          {links
            .filter((l) => !l.ownerOnly || isOwner)
            .map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(href.replace(/\/$/, ""));
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
