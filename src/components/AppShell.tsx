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

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="brand">TellTea</p>
          <p className="topbar-sub">จัดการร้าน</p>
        </div>
        <div className="topbar-user">
          <span>{user?.email}</span>
          <button type="button" className="ghost-btn" onClick={() => void signOut()}>
            <LogOut size={16} />
            ออก
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
                <Icon size={20} />
                <span>{label}</span>
              </Link>
            );
          })}
      </nav>
    </div>
  );
}
