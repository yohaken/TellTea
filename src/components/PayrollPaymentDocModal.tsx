"use client";

import { useEffect, useMemo, useState } from "react";
import {
  downloadPayrollPaymentDoc,
  printPayrollPaymentDoc,
  shopFromPosSettings,
  type PayrollPaymentDocPayee,
  type PayrollPaymentDocShop,
} from "@/lib/payroll-payment-doc";
import {
  shortTransferKindLabel,
  type StaffTransferReceipt,
} from "@/lib/payroll-staff-receipt";
import {
  getLocalPosShopSettings,
  getPosShopSettings,
} from "@/lib/pos-settings";
import { formatDateTimeShortBe, formatPlainNumber } from "@/lib/utils";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

function fmt(n: number) {
  return formatPlainNumber(n);
}

/**
 * ดูใบสรุปหลักฐานจ่ายในแอป · พิมพ์/บันทึก PDF · ดาวน์โหลดไฟล์เก็บ
 */
export function PayrollPaymentDocModal({
  receipt,
  payee,
  onClose,
}: {
  receipt: StaffTransferReceipt;
  payee: PayrollPaymentDocPayee;
  onClose: () => void;
}) {
  const [shop, setShop] = useState<PayrollPaymentDocShop>(() =>
    shopFromPosSettings(getLocalPosShopSettings()),
  );
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  useBodyScrollLock(true);

  useEffect(() => {
    let alive = true;
    void getPosShopSettings()
      .then((s) => {
        if (alive) setShop(shopFromPosSettings(s));
      })
      .catch(() => {
        /* keep local */
      });
    return () => {
      alive = false;
    };
  }, []);

  const bankLine = useMemo(
    () =>
      [payee.payBank, payee.payAccountNo, payee.payAccountName]
        .filter(Boolean)
        .join(" · "),
    [payee],
  );

  function onPrintPdf() {
    const ok = printPayrollPaymentDoc({ receipt, shop, payee });
    setActionMsg(
      ok
        ? "เปิดหน้าพิมพ์แล้ว — เลือกเครื่องพิมพ์หรือ「บันทึกเป็น PDF」ได้"
        : "เปิดหน้าพิมพ์ไม่ได้ — อนุญาตป๊อปอัปแล้วลองใหม่",
    );
  }

  function onDownload() {
    const ok = downloadPayrollPaymentDoc({ receipt, shop, payee });
    setActionMsg(
      ok
        ? "ดาวน์โหลดไฟล์แล้ว — เปิดไฟล์แล้วพิมพ์/บันทึก PDF ได้"
        : "ดาวน์โหลดไม่สำเร็จ",
    );
  }

  return (
    <div
      className="modal-backdrop edit-modal is-module-form"
      onClick={onClose}
    >
      <div
        className="modal-card module-form-card payroll-payment-doc-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="ใบสรุปหลักฐานการจ่าย"
      >
        <h2
          className="panel-title"
          style={{ fontSize: "1rem", marginBottom: "0.35rem" }}
        >
          ใบสรุปหลักฐานการจ่าย
        </h2>
        <p className="muted" style={{ margin: "0 0 0.75rem", fontSize: "0.82rem" }}>
          {shop.shopName}
          {shop.shopNameTh ? ` · ${shop.shopNameTh}` : ""}
          {shop.taxId ? ` · เลขผู้เสียภาษี ${shop.taxId}` : ""}
        </p>

        <div className="payroll-payment-doc-preview" aria-label="รายละเอียดใบสรุป">
          <div className="payroll-payment-doc-row">
            <span className="muted">ผู้รับ</span>
            <strong>{payee.employeeName}</strong>
          </div>
          {bankLine ? (
            <div className="payroll-payment-doc-row">
              <span className="muted">บัญชี</span>
              <span>{bankLine}</span>
            </div>
          ) : null}
          <div className="payroll-payment-doc-row">
            <span className="muted">งวด</span>
            <span>
              {receipt.periodMonth}
              {receipt.combined ? " · โอนรวม" : ""}
            </span>
          </div>
          <div className="payroll-payment-doc-row">
            <span className="muted">วันโอน</span>
            <span>
              {receipt.paidAt ? formatDateTimeShortBe(receipt.paidAt) : "—"}
            </span>
          </div>

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

          <div className="payroll-payment-doc-total">
            <span>รวมยอดโอน</span>
            <strong>฿{fmt(receipt.transferTotal)}</strong>
          </div>

          <p className="muted" style={{ margin: "0.55rem 0 0", fontSize: "0.78rem" }}>
            {receipt.slipUrls.length
              ? `มีสลิปโอนในระบบ ${receipt.slipUrls.length} รูป`
              : "ยังไม่มีสลิปโอนแนบ"}
            {" · "}เอกสารภายในร้าน (ไม่ใช่ใบหักภาษี ณ ที่จ่าย)
          </p>
        </div>

        {actionMsg ? (
          <p className="success-text" style={{ margin: "0.65rem 0 0" }}>
            {actionMsg}
          </p>
        ) : null}

        <div className="module-form-actions" style={{ marginTop: "0.85rem" }}>
          <button type="button" className="primary-btn" onClick={onPrintPdf}>
            พิมพ์ / บันทึก PDF
          </button>
          <button type="button" className="ghost-btn" onClick={onDownload}>
            ดาวน์โหลดไฟล์
          </button>
          <button type="button" className="ghost-btn" onClick={onClose}>
            ปิด
          </button>
        </div>
      </div>
    </div>
  );
}
