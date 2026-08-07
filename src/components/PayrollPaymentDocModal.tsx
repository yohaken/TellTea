"use client";

import { useEffect, useMemo, useState } from "react";
import {
  formatPayrollPaidAtLabel,
  formatPayrollPeriodLabel,
  legalNameForPaymentDoc,
  openPaymentDocViewerShell,
  shopFromPosSettings,
  viewPayrollPaymentDoc,
  type PayrollPaymentDocPayee,
  type PayrollPaymentDocShop,
} from "@/lib/payroll-payment-doc";
import {
  DEFAULT_PAYROLL_PAYMENT_DOC_SETTINGS,
  getPayrollPaymentDocSettings,
  type PayrollPaymentDocSettings,
} from "@/lib/payroll-payment-doc-settings";
import {
  shortTransferKindLabel,
  type StaffTransferReceipt,
} from "@/lib/payroll-staff-receipt";
import {
  getLocalPosShopSettings,
  getPosShopSettings,
} from "@/lib/pos-settings";
import { getStaffPersonal } from "@/lib/staff-personal";
import { formatPlainNumber } from "@/lib/utils";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

function fmt(n: number) {
  return formatPlainNumber(n);
}

/**
 * ดูใบสรุปหลักฐานจ่ายในแอป · เปิดเอกสาร PDF มาตรฐาน A4 ในแท็บใหม่
 */
export function PayrollPaymentDocModal({
  receipt,
  payee,
  linkedStaffId,
  onClose,
}: {
  receipt: StaffTransferReceipt;
  payee: PayrollPaymentDocPayee;
  /** โหลดชื่อจริง–นามสกุลจาก staffPersonal ถ้ายังไม่มีใน payee */
  linkedStaffId?: string;
  onClose: () => void;
}) {
  const [shop, setShop] = useState<PayrollPaymentDocShop>(() =>
    shopFromPosSettings(getLocalPosShopSettings()),
  );
  const [payer, setPayer] = useState<PayrollPaymentDocSettings>(
    DEFAULT_PAYROLL_PAYMENT_DOC_SETTINGS,
  );
  const [resolvedPayee, setResolvedPayee] = useState(payee);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  useBodyScrollLock(true);

  useEffect(() => {
    setResolvedPayee(payee);
  }, [payee]);

  useEffect(() => {
    let alive = true;
    void getPosShopSettings()
      .then((s) => {
        if (alive) setShop(shopFromPosSettings(s));
      })
      .catch(() => {
        /* keep local */
      });
    void getPayrollPaymentDocSettings()
      .then((s) => {
        if (alive) setPayer(s);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const sid = (linkedStaffId || "").trim();
    if (!sid) return;
    if (payee.legalFirstName && payee.legalLastName) return;
    let alive = true;
    void getStaffPersonal(sid)
      .then((personal) => {
        if (!alive || !personal) return;
        setResolvedPayee((prev) => ({
          ...prev,
          legalFirstName:
            prev.legalFirstName || (personal.legalFirstName || "").trim() || undefined,
          legalLastName:
            prev.legalLastName || (personal.legalLastName || "").trim() || undefined,
        }));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [linkedStaffId, payee.legalFirstName, payee.legalLastName]);

  const bankLine = useMemo(
    () =>
      [resolvedPayee.payBank, resolvedPayee.payAccountNo, resolvedPayee.payAccountName]
        .filter(Boolean)
        .join(" · "),
    [resolvedPayee],
  );

  const recipient = legalNameForPaymentDoc(resolvedPayee);

  async function onViewDoc() {
    const viewer = openPaymentDocViewerShell();
    if (!viewer) {
      setActionMsg("อนุญาตป๊อปอัปเพื่อดูเอกสาร");
      return;
    }
    setActionMsg("กำลังเปิดเอกสาร…");
    const ok = await viewPayrollPaymentDoc({
      receipt,
      shop,
      payee: resolvedPayee,
      payer,
      targetWindow: viewer,
    });
    setActionMsg(
      ok
        ? "เปิดเอกสารแล้ว — บันทึกจากตัวดูไฟล์ได้"
        : "เปิดเอกสารไม่สำเร็จ",
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
        aria-label="หลักฐานการจ่ายค่าจ้างและเงินเดือน"
      >
        <h2
          className="panel-title"
          style={{ fontSize: "1rem", marginBottom: "0.35rem" }}
        >
          หลักฐานการจ่ายค่าจ้าง
        </h2>
        <p className="muted" style={{ margin: "0 0 0.75rem", fontSize: "0.82rem" }}>
          เอกสารมาตรฐาน A4 · กดดูเอกสารแล้วบันทึก PDF จากตัวดูไฟล์ได้
          {shop.shopName ? ` · ${shop.shopName}` : ""}
        </p>

        <div className="payroll-payment-doc-preview" aria-label="รายละเอียดใบสรุป">
          <div className="payroll-payment-doc-row">
            <span className="muted">ผู้รับ</span>
            <strong>{recipient}</strong>
          </div>
          <div className="payroll-payment-doc-row">
            <span className="muted">ผู้จ่าย</span>
            <span>
              {payer.payerName}
              {payer.payerTitle ? ` · ${payer.payerTitle}` : ""}
            </span>
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
              {formatPayrollPeriodLabel(receipt.periodMonth)}
              {receipt.combined ? " · โอนรวม" : ""}
            </span>
          </div>
          <div className="payroll-payment-doc-row">
            <span className="muted">วันโอน</span>
            <span>
              {receipt.paidAt ? formatPayrollPaidAtLabel(receipt.paidAt) : "—"}
            </span>
          </div>

          <ul className="payroll-latest-transfer-lines">
            {receipt.lines.map((line) => (
              <li key={line.item.id}>
                <span>{shortTransferKindLabel(line.kind)}</span>
                <span>
                  ฿{fmt(line.amount)}
                  {line.advanceDeduct > 0
                    ? ` · คืนเบิก ฿${fmt(line.advanceDeduct)} (ได้ไปก่อนแล้ว)`
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
          <button
            type="button"
            className="primary-btn payroll-doc-dl-btn"
            onClick={() => void onViewDoc()}
          >
            ดูเอกสาร
          </button>
          <button type="button" className="ghost-btn" onClick={onClose}>
            ปิด
          </button>
        </div>
      </div>
    </div>
  );
}
