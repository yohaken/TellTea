"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownLeft,
  Bell,
  BookMarked,
  ChartColumn,
  CircleDollarSign,
  ClipboardList,
  Download,
  Settings,
  UserCircle,
  Users,
} from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth";
import { needsPersonalProfileSetup, needsProfileSetup, personalProfileLabel } from "@/lib/profile";
import { can, hasAnyExtraPermission, type PermissionKey } from "@/lib/permissions";
import { isAppOwnerEmail } from "@/lib/firebase";

export default function MorePage() {
  return (
    <AuthGate>
      <MoreView />
    </AuthGate>
  );
}

function MoreView() {
  const { staff, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (staff && !hasAnyExtraPermission(staff)) router.replace("/ledger/");
  }, [staff, router]);

  if (!hasAnyExtraPermission(staff)) return null;

  const tools: {
    href: string;
    title: string;
    desc: string;
    icon: typeof ChartColumn;
    perm: PermissionKey;
  }[] = [
    {
      href: "/bonus/",
      title: "สรุปโบนัสเดือน",
      desc: "ขาย + ผลิต + ชง แบบ real-time",
      icon: CircleDollarSign,
      perm: "bonus",
    },
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
      href: "/alerts/",
      title: "แจ้งเตือนยอดต่ำ",
      desc: "ตั้งเกณฑ์ + แจ้งถึงมือถือเมื่อเงินใกล้หมด",
      icon: Bell,
      perm: "alerts",
    },
    {
      href: "/in/",
      title: "โอนเข้า",
      desc: "เติมเงินเข้าบัญชีร้าน",
      icon: ArrowDownLeft,
      perm: "transferIn",
    },
    {
      href: "/export/",
      title: "ส่งออก",
      desc: "ดาวน์โหลดบช. / รายงานเป็น Excel",
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

  const visible = tools.filter((t) => can(staff, t.perm));
  const isOwner = staff?.role === "owner";
  const profileIncomplete = needsProfileSetup(staff);
  const personalIncomplete = needsPersonalProfileSetup(staff);

  return (
    <div>
      <h1 className="panel-title">อื่นๆ</h1>
      <p className="muted" style={{ marginBottom: "1rem", textAlign: "left" }}>
        เครื่องมือตามสิทธิ์ที่ได้รับ
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
          <Link href="/settings/" className="more-card">
            <Settings size={22} />
            <div>
              <strong>ตั้งค่าโมดูล</strong>
              <p>ผลิต · ชง · SmartCheck — สินค้า เรท และรายการเช็ค</p>
            </div>
          </Link>
        ) : null}
        {visible.map(({ href, title, desc, icon: Icon }) => (
          <Link key={href} href={href} className="more-card">
            <Icon size={22} />
            <div>
              <strong>{title}</strong>
              <p>{desc}</p>
            </div>
          </Link>
        ))}
        {staff?.role === "owner" || isAppOwnerEmail(user?.email) ? (
          <Link href="/tasks/" className="more-card">
            <ClipboardList size={22} />
            <div>
              <strong>งานมอบหมาย</strong>
              <p>มอบงาน checklist + รูปหลักฐาน · เจ้าของแก้ไข/ลบได้</p>
            </div>
          </Link>
        ) : null}
      </div>
    </div>
  );
}
