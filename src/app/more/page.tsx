"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownLeft, FileSpreadsheet, Users } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth";

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

  useEffect(() => {
    if (staff && staff.role !== "owner") router.replace("/ledger/");
  }, [staff, router]);

  if (staff?.role !== "owner") return null;

  const tools = [
    {
      href: "/in/",
      title: "โอนเข้า",
      desc: "เจ้าของเติมเงินเข้าบัญชีร้าน",
      icon: ArrowDownLeft,
    },
    {
      href: "/import/",
      title: "นำเข้า Excel",
      desc: "โหลดรายการจากชีทเดิม",
      icon: FileSpreadsheet,
    },
    {
      href: "/staff/",
      title: "พนักงาน",
      desc: "เพิ่มอีเมลคนเข้าใช้งาน",
      icon: Users,
    },
  ];

  return (
    <div>
      <h1 className="panel-title">อื่นๆ</h1>
      <p className="muted" style={{ marginBottom: "1rem", textAlign: "left" }}>
        เครื่องมือเจ้าของ — ช่วงนี้เข้าได้ทุกหน้าเพื่อเทส รวมบัญชีรายวันแบบพนักงานที่แท็บล่าง
      </p>
      <div className="more-grid">
        {tools.map(({ href, title, desc, icon: Icon }) => (
          <Link key={href} href={href} className="more-card">
            <Icon size={22} />
            <div>
              <strong>{title}</strong>
              <p>{desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
