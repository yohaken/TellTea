"use client";

import type { OtStatus } from "@/lib/ot";
import type { ProdStatus } from "@/lib/production";

export type PayStatus = ProdStatus | OtStatus;

const STATUS_ACTIONS: { status: PayStatus; label: string; className?: string }[] = [
  { status: "paid", label: "จ่ายแล้ว", className: "is-paid" },
  { status: "pending", label: "เตรียมจ่าย", className: "is-pending" },
  { status: "unpaid", label: "ยังไม่จ่าย" },
];

export function BulkStatusToolbar({
  selectedCount,
  month,
  onMonthChange,
  onSelectUnpaid,
  onSelectVisible,
  onClear,
  onSetStatus,
  busy,
  visibleCount,
  unpaidCount,
}: {
  selectedCount: number;
  month?: string;
  onMonthChange?: (value: string) => void;
  onSelectUnpaid?: () => void;
  onSelectVisible?: () => void;
  onClear: () => void;
  onSetStatus: (status: PayStatus) => void;
  busy?: boolean;
  visibleCount: number;
  unpaidCount: number;
}) {
  return (
    <div className="bulk-status-toolbar">
      {month != null && onMonthChange ? (
        <input
          type="month"
          className="ot-slim-input"
          value={month}
          onChange={(e) => onMonthChange(e.target.value)}
          aria-label="เดือน"
        />
      ) : null}
      <button type="button" className="ghost-btn bulk-status-chip" disabled={busy || !unpaidCount} onClick={onSelectUnpaid}>
        เลือกที่ยังไม่จ่าย ({unpaidCount})
      </button>
      <button type="button" className="ghost-btn bulk-status-chip" disabled={busy || !visibleCount} onClick={onSelectVisible}>
        เลือกที่แสดง ({visibleCount})
      </button>

      {selectedCount > 0 ? (
        <div className="bulk-status-actions" role="group" aria-label="เปลี่ยนสถานะกลุ่ม">
          <span className="bulk-status-count">เลือก {selectedCount} รายการ</span>
          {STATUS_ACTIONS.map((action) => (
            <button
              key={action.status}
              type="button"
              className={action.className ? `ghost-btn bulk-status-btn ${action.className}` : "ghost-btn bulk-status-btn"}
              disabled={busy}
              onClick={() => onSetStatus(action.status)}
            >
              {action.label}
            </button>
          ))}
          <button type="button" className="ghost-btn bulk-status-clear" disabled={busy} onClick={onClear}>
            ยกเลิก
          </button>
        </div>
      ) : (
        <p className="muted bulk-status-hint">ติ๊กเลือกหลายแถว → เปลี่ยนสถานะเป็นกลุ่ม (เช่นจ่ายสิ้นเดือน)</p>
      )}
    </div>
  );
}
