"use client";

import { Receipt } from "lucide-react";
import { PosSalesReport, PosSalesReportLink } from "@/components/PosSalesReport";
import { startOfLocalDay } from "@/lib/utils";

export function PosSalesSetup({ onError }: { onError: (msg: string | null) => void }) {
  return (
    <section className="settings-card">
      <div className="settings-card-head-row">
        <h2 className="settings-card-title" style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
          <Receipt size={18} aria-hidden />
          ยอดขาย POS วันนี้
        </h2>
        <PosSalesReportLink />
      </div>
      <p className="muted settings-card-lead">
        สรุปจากบิลจริง — ไม่รวมบัญชีพนักงาน
      </p>
      <PosSalesReport dateMs={startOfLocalDay()} onError={onError} compact />
    </section>
  );
}
