"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
  Boxes,
  FileSpreadsheet,
  LogOut,
  MoreHorizontal,
  Users,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { AppBrand } from "@/components/AppBrand";
import { cn } from "@/lib/utils";

/** งานวันต่อวัน — พนักงานและเจ้าของใช้ร่วมกัน */
const dailyLinks = [
  { href: "/ledger/", label: "บัญชี", icon: BookOpen },
  { href: "/out/", label: "จ่าย", icon: ArrowUpRight },
  { href: "/stock/", label: "สต็อก", icon: Boxes },
];

/** เครื่องมือเจ้าของ — ช่วงเทสเจ้าของเข้าได้หมด */
const ownerLinks = [
  { href: "/in/", label: "โอนเข้า", icon: ArrowDownLeft },
  { href: "/import/", label: "นำเข้า", icon: FileSpreadsheet },
  { href: "/staff/", label: "พนักงาน", icon: Users },
  { href: "/more/", label: "อื่นๆ", icon: MoreHorizontal },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { staff, user, signOut } = useAuth();
  const isOwner = staff?.role === "owner";
  const emailShort = user?.email?.split("@")[0] || "";
  const roleLabel = isOwner ? "เจ้าของ · เทสได้ทุกหน้า" : "พนักงาน";

  const links = isOwner
    ? [
        ...dailyLinks,
        { href: "/more/", label: "อื่นๆ", icon: MoreHorizontal },
      ]
    : dailyLinks;

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

        <nav className="bottom-nav">
          {links.map(({ href, label, icon: Icon }) => {
            const active =
              pathname === href ||
              pathname.startsWith(href.replace(/\/$/, "")) ||
              (href === "/more/" &&
                ownerLinks.some(
                  (l) => l.href !== "/more/" && pathname.startsWith(l.href.replace(/\/$/, "")),
                ));
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
