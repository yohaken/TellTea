"use client";

import { AuthGate } from "@/components/AuthGate";
import { StaffUtilityPanel } from "@/components/StaffUtilityPanel";

/** โมดูลหลังร้าน — ข้อเสนอ + ลิงก์กระดานโนต (เจ้าของใช้ที่นี่ ไม่มีไอคอนลอย) */
export default function UtilityPage() {
  return (
    <AuthGate>
      <div className="staff-utility-page">
        <h1 className="panel-title">ยูทิลิตี้</h1>
        <p className="muted staff-utility-page-lead">
          ข้อเสนอจากพนักงาน · กระดานโนต
        </p>
        <StaffUtilityPanel embedded />
      </div>
    </AuthGate>
  );
}
