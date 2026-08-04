"use client";

import { EntryPhotoIndicator, ImagePreviewModal } from "@/components/EntryPhotoCell";
import { PayrollPaymentDocModal } from "@/components/PayrollPaymentDocModal";
import type { Employee } from "@/lib/employees";
import { payeeFromEmployee } from "@/lib/payroll-payment-doc";
import {
  findLatestStaffTransferReceipt,
  shortTransferKindLabel,
  type StaffTransferReceipt,
} from "@/lib/payroll-staff-receipt";
import type { PayrollItem } from "@/lib/payroll";
import { formatDateShortBe, formatPlainNumber } from "@/lib/utils";
import { useMemo, useState } from "react";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

function fmt(n: number) {
  return formatPlainNumber(n);
}

export type StaffBonusExplain = {
  total: number;
  deductAmount: number;
  deductPct: number;
  remaining: number;
};

/**
 * การ์ดรอบโอนล่าสุด — มุมพนักงาน / ดูแบบพนักงาน
 * โชว์เมื่อไม่มี pending ในเดือนที่เลือก หรือโชว์เหนือคิวเสมอถ้ามีประวัติจ่าย
 */
export function StaffLatestTransferCard({
  items,
  periodMonth,
  employees,
  bonusExplain,
  onOpenBonusMonth,
  onOpenHistory,
}: {
  items: PayrollItem[];
  /** เดือนที่เลือกในแท็บ — ใช้จับคู่คำอธิบายหักโบนัส */
  periodMonth: string;
  employees?: Employee[];
  bonusExplain?: StaffBonusExplain | null;
  onOpenBonusMonth?: (periodMonth: string) => void;
  onOpenHistory?: (periodMonth: string) => void;
}) {
  const receipt = useMemo(() => findLatestStaffTransferReceipt(items), [items]);
  const [preview, setPreview] = useState<{ urls: string[]; title: string } | null>(
    null,
  );
  const [docOpen, setDocOpen] = useState(false);
  useBodyScrollLock(!!preview || docOpen);

  if (!receipt) return null;

  const pendingHere = items.some(
    (i) => i.periodMonth === periodMonth && i.status === "pending",
  );
  const explain =
    bonusExplain &&
    receipt.periodMonth === periodMonth &&
    receipt.lines.some((l) => l.kind === "bonus")
      ? bonusExplain
      : null;

  return (
    <>
      <section
        className="payroll-latest-transfer"
        aria-label="รอบโอนล่าสุดที่เข้าบัญชีคุณ"
      >
        <header className="payroll-latest-transfer-head">
          <div>
            <span className="bonus-summary-label">รอบล่าสุด · เข้าบัญชีคุณ</span>
            <strong className="payroll-latest-transfer-total">
              ฿{fmt(receipt.transferTotal)}
            </strong>
            <span className="muted bonus-summary-pool-meta">
              งวด {receipt.periodMonth}
              {receipt.paidAt
                ? ` · โอน ${formatDateShortBe(receipt.paidAt)}`
                : ""}
              {receipt.combined ? " · โอนรวมสิ้นเดือน+โบนัส" : ""}
            </span>
          </div>
          {receipt.slipUrls.length ? (
            <EntryPhotoIndicator
              imageUrls={receipt.slipUrls}
              label="สลิป"
              onView={() =>
                setPreview({
                  urls: receipt.slipUrls,
                  title: `สลิป · ${receipt.periodMonth}`,
                })
              }
            />
          ) : (
            <span className="muted">ไม่มีสลิป</span>
          )}
        </header>

        <ul className="payroll-latest-transfer-lines">
          {receipt.lines.map((line) => (
            <li key={line.item.id}>
              <span>{shortTransferKindLabel(line.kind)}</span>
              <span>
                ฿{fmt(line.amount)}
                {line.advanceDeduct > 0
                  ? ` · หักเบิก ฿${fmt(line.advanceDeduct)}`
                  : ""}
              </span>
            </li>
          ))}
        </ul>

        {receipt.combined ? (
          <p className="muted payroll-latest-transfer-note">
            โอนครั้งเดียว ฿{fmt(receipt.transferTotal)} — ในรายการยังแยกสิ้นเดือน/โบนัสให้ดู
          </p>
        ) : null}

        {explain && explain.deductAmount > 0 ? (
          <p className="payroll-latest-transfer-bonus">
            โบนัสก่อนหัก ฿{fmt(explain.total)} − หักร้าน ฿{fmt(explain.deductAmount)} (
            {fmtPct(explain.deductPct)}) = โอน ฿{fmt(explain.remaining)}
          </p>
        ) : null}

        {receipt.note ? (
          <p className="muted payroll-latest-transfer-note">{receipt.note}</p>
        ) : null}

        <div className="payroll-latest-transfer-actions">
          <button
            type="button"
            className="primary-btn"
            onClick={() => setDocOpen(true)}
          >
            ดูใบสรุปจ่าย
          </button>
          {onOpenBonusMonth ? (
            <button
              type="button"
              className="ghost-btn"
              onClick={() => onOpenBonusMonth(receipt.periodMonth)}
            >
              สรุปโบนัส + หลักฐานหัก
            </button>
          ) : null}
          {onOpenHistory ? (
            <button
              type="button"
              className="ghost-btn"
              onClick={() => onOpenHistory(receipt.periodMonth)}
            >
              เปิดหลักฐานงวดนี้
            </button>
          ) : null}
        </div>

        <p className="muted payroll-latest-transfer-foot">
          ไม่แจ้งแชทตอนโอน — ดูยอด สลิป และใบสรุปที่นี่
          {pendingHere
            ? " · ยังมีรายการรอโอนในเดือนที่เลือกด้านล่าง"
            : " · แท็บรอโอนว่างเมื่อจ่ายครบแล้ว"}
        </p>
      </section>

      {preview ? (
        <ImagePreviewModal
          urls={preview.urls}
          title={preview.title}
          onClose={() => setPreview(null)}
        />
      ) : null}

      {docOpen ? (
        <PayrollPaymentDocModal
          receipt={receipt}
          payee={payeeFromEmployee(
            employees?.find((e) => e.id === receipt.lines[0]?.item.employeeId),
            receipt.lines[0]?.item.employeeName,
          )}
          onClose={() => setDocOpen(false)}
        />
      ) : null}
    </>
  );
}

function fmtPct(n: number) {
  const r = Math.round(n * 100) / 100;
  return `${r}%`;
}

/** สำหรับทดสอบ / re-export */
export type { StaffTransferReceipt };
