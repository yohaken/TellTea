"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { ImagePreviewModal } from "@/components/EntryPhotoCell";
import { PhotoAttachMultiField } from "@/components/PhotoAttachMultiField";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { addLedgerEntry, LEDGER_RECEIPT_MAX } from "@/lib/ledger";
import { parseDateInput, todayInputValue } from "@/lib/utils";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

export default function TransferInPage() {
  return (
    <AuthGate>
      <TransferInView />
    </AuthGate>
  );
}

function TransferInView() {
  const { actorId, staff } = useAuth();
  const router = useRouter();
  const [date, setDate] = useState(todayInputValue());
  const [description, setDescription] = useState("โอนเข้า");
  const [amount, setAmount] = useState("");
  const [receiptUrls, setReceiptUrls] = useState<string[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allowed = can(staff, "transferIn");

  useBodyScrollLock(allowed);

  useEffect(() => {
    if (staff && !allowed) {
      router.replace("/ledger/");
    }
  }, [staff, allowed, router]);

  function close() {
    router.replace("/ledger/");
  }

  if (!allowed) {
    return null;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!actorId) return;
    setBusy(true);
    setError(null);
    try {
      const urls = receiptUrls.filter(Boolean).slice(0, LEDGER_RECEIPT_MAX);
      if (urls.some((u) => u.startsWith("data:"))) {
        throw new Error("รูปเก่ายังฝังในเอกสาร — ลบแล้วแนบใหม่เพื่อบันทึกเข้าคลังหลักฐาน");
      }
      await addLedgerEntry({
        date: parseDateInput(date),
        description,
        amountIn: Number(amount),
        amountOut: 0,
        type: "โอนเข้า",
        createdBy: actorId,
        receiptUrls: urls,
      });
      close();
    } catch (err) {
      setError((err as Error).message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-backdrop edit-modal is-module-form is-transfer-in-form"
      role="presentation"
      onClick={close}
    >
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="โอนเข้า"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="entry-toolbar module-form-head">
          <h2 className="panel-title">โอนเข้า</h2>
          <button
            type="button"
            className="ghost-btn icon-btn"
            aria-label="ปิด"
            disabled={busy}
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
        <p className="muted form-hint-inline transfer-in-hint">
          เติมเงินเข้าบัญชีร้าน — แนบสลิปได้หลายใบถ้ามี
        </p>
        {error ? <p className="error-text transfer-in-error">{error}</p> : null}
        <form className="form-card module-entry-form transfer-in-form" onSubmit={(e) => void onSubmit(e)}>
          <div className="field">
            <label htmlFor="transfer-in-date">วันที่</label>
            <input
              id="transfer-in-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="transfer-in-desc">รายการ</label>
            <input
              id="transfer-in-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="transfer-in-amount">จำนวนเงินเข้า (บาท)</label>
            <input
              id="transfer-in-amount"
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="30000"
              required
            />
          </div>
          <PhotoAttachMultiField
            label="สลิป / รูปถ่าย (ถ้ามี)"
            values={receiptUrls}
            onChange={setReceiptUrls}
            onError={setError}
            max={LEDGER_RECEIPT_MAX}
            storageFolder="ledger-receipts"
            storageSlotKey="transfer-in"
            hint={`บันทึกหลักฐานเข้าฐานข้อมูล · สูงสุด ${LEDGER_RECEIPT_MAX} รูป`}
            allowCamera={false}
          />
          {receiptUrls.length ? (
            <button
              type="button"
              className="ghost-btn"
              style={{ marginBottom: "0.55rem" }}
              onClick={() => setPreviewUrls(receiptUrls)}
            >
              ดูรูปทั้งหมด ({receiptUrls.length})
            </button>
          ) : null}
          <div className="module-form-actions">
            <button type="submit" className="primary-btn action-in" disabled={busy}>
              {busy ? "กำลังบันทึก..." : "บันทึกโอนเข้า"}
            </button>
            <button type="button" className="ghost-btn" disabled={busy} onClick={close}>
              ออก
            </button>
          </div>
        </form>
        {previewUrls ? (
          <ImagePreviewModal
            urls={previewUrls}
            title="สลิป / รูปถ่าย"
            onClose={() => setPreviewUrls(null)}
          />
        ) : null}
      </div>
    </div>
  );
}
