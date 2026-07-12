"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, Lock, Receipt, Wallet } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { OPS_EXPENSE_QUICK_CATEGORIES } from "@/lib/ops";

type OpsTab = "expenses" | "tasks";

export default function OpsPage() {
  return (
    <AuthGate>
      <OpsView />
    </AuthGate>
  );
}

function OpsView() {
  const { staff } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<OpsTab>("expenses");

  useEffect(() => {
    if (staff && !can(staff, "opsHub")) {
      router.replace("/ledger/");
    }
  }, [staff, router]);

  if (!can(staff, "opsHub")) return null;

  return (
    <div className="module-page ops-page">
      <div className="module-page-head">
        <h1 className="panel-title module-page-title">
          <Wallet size={18} aria-hidden />
          รายจ่าย & งาน
        </h1>
        <p className="muted ops-owner-badge">
          <Lock size={12} aria-hidden /> เฉพาะเจ้าของ — พนักงานยังไม่เปิดสิทธิ์
        </p>
      </div>

      <div className="ops-tab-bar" role="tablist" aria-label="มุมมองรายจ่ายและงาน">
        <button
          type="button"
          role="tab"
          className={tab === "expenses" ? "ops-tab is-active" : "ops-tab"}
          aria-selected={tab === "expenses"}
          onClick={() => setTab("expenses")}
        >
          <Receipt size={15} aria-hidden />
          รายจ่าย
        </button>
        <button
          type="button"
          role="tab"
          className={tab === "tasks" ? "ops-tab is-active" : "ops-tab"}
          aria-selected={tab === "tasks"}
          onClick={() => setTab("tasks")}
        >
          <ClipboardList size={15} aria-hidden />
          งานรายวัน
        </button>
      </div>

      {tab === "expenses" ? <OpsExpensesAdmin /> : <OpsTasksAdmin />}

      <section className="ops-roadmap">
        <h2 className="ops-roadmap-title">แผนพัฒนา</h2>
        <ul className="ops-roadmap-list">
          <li>
            <strong>พนักงาน</strong> — บันทึกรายจ่ายวันนี้เท่านั้น · Quick Select · แนบสลิปทุกครั้ง
            (ไม่เห็นยอดโอนเข้า/คงเหลือ)
          </li>
          <li>
            <strong>พนักงาน</strong> — Checklist งานของตัวเอง · ส่งงานพร้อมรูปหลักฐาน
          </li>
          <li>
            <strong>เจ้าของ</strong> — ดูรายจ่ายทั้งร้าน · ยอดคงเหลือ · มอบหมายงาน · ตรวจรูป
          </li>
          <li>ล็อกข้ามวัน — ห้ามแก้รายการหรืองานย้อนหลัง</li>
        </ul>
      </section>
    </div>
  );
}

function OpsExpensesAdmin() {
  return (
    <section className="ops-panel">
      <h2 className="ops-panel-title">รายจ่าย — มุมมองเจ้าของ</h2>
      <p className="muted ops-panel-hint">
        กำลังพัฒนา · จะแสดงรายการจ่ายทั้งร้าน ยอดคงเหลือรวม และรูปใบเสร็จ
      </p>
      <div className="ops-empty-card">
        <Receipt size={28} aria-hidden />
        <p>ยังไม่มีข้อมูลรายจ่าย</p>
      </div>
      <div className="ops-preview-block">
        <p className="ops-preview-label">Quick Select (พนักงาน — ตัวอย่าง)</p>
        <div className="suggest-list">
          {OPS_EXPENSE_QUICK_CATEGORIES.map((c) => (
            <span key={c} className="suggest-chip is-disabled">
              {c}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function OpsTasksAdmin() {
  return (
    <section className="ops-panel">
      <h2 className="ops-panel-title">งานรายวัน — มอบหมาย & ตรวจส่ง</h2>
      <p className="muted ops-panel-hint">
        กำลังพัฒนา · มอบหมายงานให้พนักงาน · ตรวจรูปหลักฐานก่อน Completed
      </p>
      <div className="ops-empty-card">
        <ClipboardList size={28} aria-hidden />
        <p>ยังไม่มีงานที่มอบหมาย</p>
      </div>
    </section>
  );
}
