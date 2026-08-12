"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
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
  Sparkles,
  StickyNote,
  UserCircle,
  CreditCard,
  Users,
  UtensilsCrossed,
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
import {
  can,
  canAccessMembersHub,
  hasAnyExtraPermission,
  type PermissionKey,
} from "@/lib/permissions";
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

function MoreCardBody({
  title,
  desc,
}: {
  title: ReactNode;
  desc: ReactNode;
}) {
  return (
    <span className="more-card-text">
      <strong>{title}</strong>
      <span className="more-card-desc">{desc}</span>
    </span>
  );
}

function MoreSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="more-section" aria-label={title}>
      <h2 className="more-section-title">{title}</h2>
      <div className="more-section-panel">{children}</div>
    </section>
  );
}

export default function MorePage() {
  return (
    <AuthGate>
      <MoreView />
    </AuthGate>
  );
}

function MoreView() {
  const { staff, isPermPreview } = useAuth();
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

  const isOwner = staff?.role === "owner";

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
      desc: "แยกบช. → รวม → กำไรขาดทุน",
      icon: ChartColumn,
      perm: "pnl",
    },
    {
      href: "/owner-books/",
      title: "บัญชีเจ้าของ",
      desc: isOwner ? "เงินออก · ยอดขาย/VAT" : "บช.ส่วนตัวเจ้าของ",
      icon: BookMarked,
      perm: "ownerBooks",
    },
    {
      href: "/export/",
      title: "ส่งออกข้อมูล",
      desc: "Excel บัญชี / เจ้าของ / P&L",
      icon: Download,
      perm: "exportData",
    },
    {
      href: "/staff/",
      title: "ศูนย์รวมพนักงาน",
      desc: "รายชื่อ + สิทธิ์เข้าใช้",
      icon: Users,
      perm: "staffManage",
    },
  ];

  const membersTool = {
    href: "/members/",
    title: "สมาชิก / แต้ม",
    desc: "บัตรสมาชิก · สะสมแต้ม · ตั้งค่า",
    icon: CreditCard,
  };

  const extraTools = [
    ...tools.filter((t) => can(staff, t.perm)),
    ...(canAccessMembersHub(staff) ? [membersTool] : []),
  ];
  const profileIncomplete = needsProfileSetup(staff);
  const personalIncomplete = needsPersonalProfileSetup(staff);
  const hasExtras = hasAnyExtraPermission(staff);

  const profileCard =
    !isPermPreview && profileIncomplete ? (
      <Link
        href="/profile/"
        className="more-card"
        style={{ borderColor: "rgba(196, 90, 26, 0.35)" }}
      >
        <UserCircle size={18} aria-hidden />
        <MoreCardBody
          title="ตั้งโปรไฟล์พนักงาน"
          desc={
            personalIncomplete
              ? "ชื่อ-นามสกุล + รูปบัตร ปชช."
              : "เลือกชื่อในร้าน — ยังไม่ได้ตั้ง"
          }
        />
      </Link>
    ) : !isPermPreview && !profileIncomplete && staff?.role === "staff" ? (
      <Link href="/profile/" className="more-card">
        <UserCircle size={18} aria-hidden />
        <MoreCardBody
          title="โปรไฟล์"
          desc={personalProfileLabel(staff) || staff.displayName || "ดู/แก้ไขโปรไฟล์"}
        />
      </Link>
    ) : isPermPreview ? (
      <div className="more-card" style={{ opacity: 0.85, cursor: "default" }}>
        <UserCircle size={18} aria-hidden />
        <MoreCardBody title="โปรไฟล์ (พรีวิว)" desc="ดูอย่างเดียว" />
      </div>
    ) : null;

  const shopCards = (
    <>
      {profileCard}
      <Link href="/utility/" className="more-card">
        <Sparkles size={18} aria-hidden />
        <MoreCardBody
          title="ยูทิลิตี้"
          desc={isOwner ? "ข้อเสนอจากพนักงาน" : "ข้อเสนอ · งาน"}
        />
      </Link>
      {isOwner ? (
        <Link href="/menu/" className="more-card">
          <UtensilsCrossed size={18} aria-hidden />
          <MoreCardBody title="เมนู" desc="สร้าง · ลบ · ปรับแต่งเมนู → POS" />
        </Link>
      ) : null}
      {isOwner ? (
        <Link href="/pos-sales/" className="more-card">
          <Receipt size={18} aria-hidden />
          <MoreCardBody title="POS" desc="ยอดขาย + จัดการ" />
        </Link>
      ) : null}
      {isOwner ? (
        <Link href="/business-notes/" className="more-card">
          <StickyNote size={18} aria-hidden />
          <MoreCardBody title="โนตกิจการ" desc="จดโนต · เซฟทันที" />
        </Link>
      ) : null}
      {isOwner ? (
        <Link href="/settings/" className="more-card">
          <Settings size={18} aria-hidden />
          <MoreCardBody title="ตั้งค่าโมดูล" desc="LINE สรุปเช้า · AI · เมนูหลัก · อัปเดตแอป" />
        </Link>
      ) : null}
    </>
  );

  return (
    <div className="more-page">
      <h1 className="panel-title">อื่นๆ</h1>

      <MoreSection title="ร้าน">{shopCards}</MoreSection>

      {moreModules.length ? (
        <MoreSection title="โมดูล">
          {moreModules.map(({ href, label, description, key }) => {
            const Icon = MODULE_ICONS[key];
            return (
              <Link key={key} href={href} className="more-card">
                <Icon size={18} aria-hidden />
                <MoreCardBody title={label} desc={description} />
              </Link>
            );
          })}
        </MoreSection>
      ) : null}

      {extraTools.length ? (
        <MoreSection title="เครื่องมือ">
          {extraTools.map(({ href, title, desc, icon: Icon }) => (
            <Link key={href} href={href} className="more-card">
              <Icon size={18} aria-hidden />
              <MoreCardBody title={title} desc={desc} />
            </Link>
          ))}
        </MoreSection>
      ) : null}

      {!hasExtras && moreModules.length === 0 && !isOwner && !profileIncomplete ? (
        <p className="empty">ไม่มีรายการเพิ่มเติม</p>
      ) : null}
    </div>
  );
}
