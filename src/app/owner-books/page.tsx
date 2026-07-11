"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth";

export default function OwnerBooksPage() {
  return (
    <AuthGate>
      <OwnerBooksView />
    </AuthGate>
  );
}

function OwnerBooksView() {
  const { staff } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (staff && staff.role !== "owner") {
      router.replace("/ledger/");
    }
  }, [staff, router]);

  if (staff?.role !== "owner") {
    return null;
  }

  return (
    <div>
      <div className="balance-bar">
        <span>คงเหลือ · บช.เจ้าของ</span>
        <strong>—</strong>
      </div>

      <div className="quick-actions">
        <button type="button" className="primary-btn action-out" disabled>
          บันทึกเงินออก
        </button>
      </div>

      <div className="sheet-wrap">
        <table className="sheet-table">
          <thead>
            <tr>
              <th className="col-date">วันที่</th>
              <th className="col-desc">รายการ</th>
              <th className="col-out">ออก</th>
              <th className="col-act">จัดการ</th>
            </tr>
          </thead>
          <tbody />
        </table>
      </div>

      <p className="empty">ยังไม่มีรายการ — รอเพิ่มข้อมูลบัญชีเจ้าของ</p>
    </div>
  );
}
