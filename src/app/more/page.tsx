"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookMarked,
  BookOpen,
  Boxes,
  ChartColumn,
  ChefHat,
  CircleDollarSign,
  ClipboardCheck,
  ClipboardList,
  Coffee,
  Download,
  Receipt,
  Settings,
  UserCircle,
  Users,
} from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth";
import {
  DEFAULT_DOCK_TAB_MAX,
  DEFAULT_NAV_ORDER,
  resolveNavForUser,
  subscribeNavUi,
  type NavUiSettings,
} from "@/lib/nav-menu";
import { needsPersonalProfileSetup, needsProfileSetup, personalProfileLabel } from "@/lib/profile";
import { can, hasAnyExtraPermission, type PermissionKey } from "@/lib/permissions";
import type { NavModuleKey } from "@/lib/nav-menu";

const MODULE_ICONS: Record<NavModuleKey, typeof BookOpen> = {
  ledger: BookOpen,
  production: ChefHat,
  otBonus: Coffee,
  bonus: CircleDollarSign,
  checklist: ClipboardCheck,
  stock: Boxes,
  assignTasks: ClipboardList,
};

const DEFAULT_UI: NavUiSettings = {
  navOrder: [...DEFAULT_NAV_ORDER],
  dockTabKeys: [],
  dockTabMax: DEFAULT_DOCK_TAB_MAX,
};

export default function MorePage() {
  return (
    <AuthGate>
      <MoreView />
    </AuthGate>
  );
}

function MoreView() {
  const { staff } = useAuth();
  const router = useRouter();
  const [navUi, setNavUi] = useState<NavUiSettings>(DEFAULT_UI);

  useEffect(() => {
    return subscribeNavUi(setNavUi);
  }, []);

  const { moreModules, showMoreTab } = resolveNavForUser(staff, navUi);

  useEffect(() => {
    if (staff && !showMoreTab) router.replace("/ledger/");
  }, [staff, showMoreTab, router]);

  if (!showMoreTab) return null;

  const tools: {
    href: string;
    title: string;
    desc: string;
    icon: typeof ChartColumn;
    perm: PermissionKey;
  }[] = [
    {
      href: "/pnl/",
      title: "สรุปรายเดือน",
      desc: "แยกบช. → รวม → กำไรขาดทุน · income กรอกเอง",
      icon: ChartColumn,
      perm: "pnl",
    },
    {
      href: "/owner-books/",
      title: "บัญชีเจ้าของ",
      desc: "บช.ส่วนตัวเจ้าของร้าน",
      icon: BookMarked,
      perm: "ownerBooks",
    },
    {
      href: "/export/",
      title: "ส่งออก",
      desc: "Excel บัญชีพนักงาน / บช.เจ้าของ / P&L — เฉพาะเจ้าของ",
      icon: Download,
      perm: "exportData",
    },
    {
      href: "/staff/",
      title: "ศูนย์รวมพนักงาน",
      desc: "รายชื่อร้าน + บัญชีเข้าใช้ / สิทธิ์",
      icon: Users,
      perm: "staffManage",
    },
  ];

  const extraTools = tools.filter((t) => can(staff, t.perm));
  const isOwner = staff?.role === "owner";
  const profileIncomplete = needsProfileSetup(staff);
  const personalIncomplete = needsPersonalProfileSetup(staff);
  const hasExtras = hasAnyExtraPermission(staff);

  return (
    <div>
      <h1 className="panel-title">อื่นๆ</h1>
      <p className="muted" style={{ marginBottom: "1rem", textAlign: "left" }}>
        โมดูลและเครื่องมือเพิ่มเติมตามสิทธิ์
      </p>
      <div className="more-grid">
        {profileIncomplete ? (
          <Link href="/profile/" className="more-card" style={{ borderColor: "rgba(196, 90, 26, 0.35)" }}>
            <UserCircle size={22} />
            <div>
              <strong>ตั้งโปรไฟล์พนักงาน</strong>
              <p>
                {personalIncomplete
                  ? "กรอกชื่อ-นามสกุล + รูปบัตร ปชช."
                  : "เลือกชื่อในร้าน — ยังไม่ได้ตั้ง"}
              </p>
            </div>
          </Link>
        ) : null}
        {!profileIncomplete && staff?.role === "staff" ? (
          <Link href="/profile/" className="more-card">
            <UserCircle size={22} />
            <div>
              <strong>โปรไฟล์</strong>
              <p>{personalProfileLabel(staff) || staff.displayName || "ดู/แก้ไขโปรไฟล์"}</p>
            </div>
          </Link>
        ) : null}
        {isOwner ? (
          <Link href="/pos-sales/" className="more-card">
            <Receipt size={22} />
            <div>
              <strong>POS</strong>
              <p>รายงานยอดขาย POS</p>
            </div>
          </Link>
        ) : null}
        {isOwner ? (
          <Link href="/settings/" className="more-card">
            <Settings size={22} />
            <div>
              <strong>ตั้งค่าโมดูล</strong>
              <p>โปรไฟล์ AI · เมนูหลัก · อัปเดตแอป — SmartCheck อยู่หน้าเช็ค · สินค้าผลิตอยู่หน้าผลิต</p>
            </div>
          </Link>
        ) : null}
        {moreModules.map(({ href, label, description, key }) => {
          const Icon = MODULE_ICONS[key];
          return (
            <Link key={key} href={href} className="more-card">
              <Icon size={22} />
              <div>
                <strong>{label}</strong>
                <p>{description}</p>
              </div>
            </Link>
          );
        })}
        {extraTools.map(({ href, title, desc, icon: Icon }) => (
          <Link key={href} href={href} className="more-card">
            <Icon size={22} />
            <div>
              <strong>{title}</strong>
              <p>{desc}</p>
            </div>
          </Link>
        ))}
        {!hasExtras && moreModules.length === 0 && !isOwner && !profileIncomplete ? (
          <p className="empty">ไม่มีรายการเพิ่มเติม</p>
        ) : null}
      </div>
    </div>
  );
}
