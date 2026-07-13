"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Printer, Trash2 } from "lucide-react";
import { seedDemoLocalReceipts, seedDemoLocalReceiptsIfEmpty } from "@/lib/pos-demo-receipts";
import {
  listLocalReceiptsForDay,
  voidLocalReceipt,
  type PosLocalReceipt,
} from "@/lib/pos-local-receipts";
import { printSaleDocuments } from "@/lib/pos-printer/router";
import {
  localReceiptLines,
  localReceiptToPrintPayload,
  receiptSubtotal,
} from "@/lib/pos-receipt-view";
import { subscribePosShopSettings, type PosShopSettings } from "@/lib/pos-settings";
import { usePosApp } from "@/lib/pos-app-context";
import { formatPlainNumber, startOfLocalDay } from "@/lib/utils";

type ReceiptFilter = "all" | "pending" | "synced";

const DEFAULT_SHOP: PosShopSettings = {
  shopName: "TELL TEA",
  shopNameTh: "เทล ที",
  shopAddress: "",
  shopPhone: "",
  promptPayId: "",
  autoPrintReceipt: true,
};

function formatReceiptDate(ts: number) {
  return new Date(ts).toLocaleString("th-TH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ReceiptPaper({
  receipt,
  onPrint,
  onVoid,
  voidBusy,
}: {
  receipt: PosLocalReceipt;
  onPrint: () => void;
  onVoid: () => void;
  voidBusy: boolean;
}) {
  const lines = localReceiptLines(receipt);
  const subtotal = receiptSubtotal(lines);
  const voided = receipt.voided === true;

  return (
    <div className="pos-receipt-paper-wrap">
      <article className={`pos-receipt-paper ${voided ? "is-voided" : ""}`} aria-label={`ใบเสร็จ ${receipt.billNo}`}>
        <div className="pos-receipt-paper-zigzag" aria-hidden />

        <header className="pos-receipt-paper-head">
          <p className="pos-receipt-paper-total-label">ยอดขาย</p>
          <p className="pos-receipt-paper-total">฿{formatPlainNumber(receipt.total)}</p>
          {voided ? <span className="pos-receipt-paper-void-badge">ทำลายแล้ว</span> : null}
        </header>

        <section className="pos-receipt-paper-section">
          <h3>ข้อมูลใบเสร็จ</h3>
          <dl className="pos-receipt-paper-meta">
            <div>
              <dt>เลขบิล</dt>
              <dd>#{receipt.billNo}</dd>
            </div>
            <div>
              <dt>ประเภท</dt>
              <dd>ทานที่ร้าน</dd>
            </div>
            <div>
              <dt>ชำระโดย</dt>
              <dd>{receipt.paymentMethod === "cash" ? "เงินสด" : "PromptPay"}</dd>
            </div>
            <div>
              <dt>วันที่</dt>
              <dd>{formatReceiptDate(receipt.createdAt)}</dd>
            </div>
            {receipt.paymentMethod === "cash" && receipt.cashReceived != null ? (
              <>
                <div>
                  <dt>รับเงิน</dt>
                  <dd>฿{formatPlainNumber(receipt.cashReceived)}</dd>
                </div>
                <div>
                  <dt>ทอน</dt>
                  <dd>฿{formatPlainNumber(receipt.change ?? 0)}</dd>
                </div>
              </>
            ) : null}
            {receipt.pending ? (
              <div>
                <dt>สถานะ</dt>
                <dd className="pos-receipt-paper-pending">รอส่งข้อมูล</dd>
              </div>
            ) : null}
            {voided && receipt.voidReason ? (
              <div>
                <dt>เหตุผลทำลาย</dt>
                <dd>{receipt.voidReason}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section className="pos-receipt-paper-section">
          <h3>รายการอาหาร</h3>
          <ul className="pos-receipt-paper-items">
            {lines.map((line, idx) => (
              <li key={`${receipt.id}-${idx}`} className="pos-receipt-paper-item">
                <div className="pos-receipt-paper-item-head">
                  <span className="pos-receipt-paper-item-name">
                    {line.name} <span className="pos-receipt-paper-item-qty">×{line.qty}</span>
                  </span>
                  <span className="pos-receipt-paper-item-price">
                    {formatPlainNumber(line.unitPrice * line.qty)}
                  </span>
                </div>
                {line.options.flatMap((o) =>
                  o.choiceNames.map((choice) => (
                    <p key={`${idx}-${choice}`} className="pos-receipt-paper-mod">
                      - {choice}
                    </p>
                  )),
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="pos-receipt-paper-section pos-receipt-paper-totals">
          <div className="pos-receipt-paper-total-row">
            <span>ราคาอาหารรวม</span>
            <span>{formatPlainNumber(subtotal)}</span>
          </div>
          <div className="pos-receipt-paper-total-row pos-receipt-paper-total-row--grand">
            <span>ยอดสุทธิ</span>
            <strong>{formatPlainNumber(receipt.total)}</strong>
          </div>
        </section>
      </article>

      <div className="pos-receipt-paper-actions">
        <button type="button" className="pos-btn-orange pos-receipt-action-btn" onClick={onPrint} disabled={voided}>
          <Printer size={20} aria-hidden />
          พิมพ์ใบเสร็จ
        </button>
        <button
          type="button"
          className="pos-btn-orange pos-receipt-action-btn pos-receipt-action-btn--void"
          onClick={onVoid}
          disabled={voided || voidBusy}
        >
          <Trash2 size={20} aria-hidden />
          {voidBusy ? "กำลังทำลาย..." : "ทำลายบิล (Void)"}
        </button>
      </div>
    </div>
  );
}

export function PosReceiptsView() {
  const dayStart = startOfLocalDay();
  const { session } = usePosApp();
  const [rows, setRows] = useState(() => listLocalReceiptsForDay(dayStart));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<ReceiptFilter>("all");
  const [shop, setShop] = useState<PosShopSettings>(DEFAULT_SHOP);
  const [voidBusy, setVoidBusy] = useState(false);
  const [demoMsg, setDemoMsg] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setRows(listLocalReceiptsForDay(dayStart));
  }, [dayStart]);

  useEffect(() => {
    const unsub = subscribePosShopSettings(setShop);
    return unsub;
  }, []);

  useEffect(() => {
    const seeded = seedDemoLocalReceiptsIfEmpty(session?.id);
    if (seeded) setDemoMsg(`โหลดข้อมูลทดสอบ ${seeded.added} บิล`);
    refresh();
    const t = window.setInterval(refresh, 3000);
    return () => window.clearInterval(t);
  }, [dayStart, refresh, session?.id]);

  const filtered = useMemo(() => {
    let list = rows;
    if (filter === "pending") list = list.filter((r) => r.pending && !r.voided);
    if (filter === "synced") list = list.filter((r) => !r.pending && !r.voided);
    return list;
  }, [rows, filter]);

  const selected = useMemo(
    () => filtered.find((r) => r.id === selectedId) || filtered[0] || null,
    [filtered, selectedId],
  );

  const pendingCount = rows.filter((r) => r.pending && !r.voided).length;

  async function handlePrint(receipt: PosLocalReceipt) {
    const payload = localReceiptToPrintPayload(receipt, shop);
    await printSaleDocuments(payload, { receiptOnly: true });
  }

  async function handleVoid(receipt: PosLocalReceipt) {
    const reason = window.prompt(`ทำลายบิล #${receipt.billNo}?\nใส่เหตุผล (ถ้ามี):`, "");
    if (reason === null) return;
    setVoidBusy(true);
    try {
      voidLocalReceipt(receipt.id, reason || undefined);
      refresh();
    } finally {
      setVoidBusy(false);
    }
  }

  function loadDemoData() {
    const result = seedDemoLocalReceipts(session?.id);
    setDemoMsg(`เพิ่มข้อมูลทดสอบ ${result.added} บิล (รวม ${result.total})`);
    refresh();
  }

  return (
    <div className="pos-module pos-module--split pos-receipts-module">
      <div className="pos-receipts-list-pane">
        <header className="pos-receipts-head">
          <h2>ประวัติใบเสร็จ</h2>
          <p className="muted">
            {new Date(dayStart).toLocaleDateString("th-TH", {
              weekday: "short",
              day: "2-digit",
              month: "short",
              year: "numeric",
            })}
            {pendingCount > 0 ? ` · รอส่ง ${pendingCount}` : ""}
          </p>
          <div className="pos-receipts-channel-tabs">
            <button type="button" className="is-active">
              ทานที่ร้าน
            </button>
            <button type="button" disabled title="เร็วๆ นี้">
              สั่งกลับบ้าน
            </button>
            <button type="button" disabled title="เร็วๆ นี้">
              เดลิเวอรี่
            </button>
          </div>
          <div className="pos-receipts-filters">
            <button type="button" className={filter === "all" ? "is-active" : ""} onClick={() => setFilter("all")}>
              ทั้งหมด ({rows.length})
            </button>
            <button
              type="button"
              className={filter === "pending" ? "is-active" : ""}
              onClick={() => setFilter("pending")}
            >
              รอส่ง ({rows.filter((r) => r.pending && !r.voided).length})
            </button>
            <button
              type="button"
              className={filter === "synced" ? "is-active" : ""}
              onClick={() => setFilter("synced")}
            >
              ส่งแล้ว ({rows.filter((r) => !r.pending && !r.voided).length})
            </button>
          </div>
          <button type="button" className="pos-receipts-demo-btn" onClick={loadDemoData}>
            โหลดข้อมูลทดสอบ
          </button>
          {demoMsg ? <p className="ok-text pos-receipts-demo-msg">{demoMsg}</p> : null}
        </header>
        <ul className="pos-receipts-list">
          {filtered.length ? (
            filtered.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className={`pos-receipts-row ${selected?.id === r.id ? "is-active" : ""} ${r.voided ? "is-voided" : ""}`}
                  onClick={() => setSelectedId(r.id)}
                >
                  <span className="pos-receipts-row-id">#{r.billNo}</span>
                  <span className="pos-receipts-row-total">฿{formatPlainNumber(r.total)}</span>
                  <span className="muted pos-receipts-row-sub">ทานที่ร้าน</span>
                  <span className="muted pos-receipts-row-time">
                    {new Date(r.createdAt).toLocaleTimeString("th-TH", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {r.voided ? " · ทำลายแล้ว" : r.pending ? " · รอส่ง" : ""}
                  </span>
                </button>
              </li>
            ))
          ) : (
            <li className="pos-module-empty muted">
              {filter === "all" ? "ยังไม่มีใบเสร็จวันนี้ — กดโหลดข้อมูลทดสอบ" : "ไม่มีรายการในตัวกรองนี้"}
            </li>
          )}
        </ul>
      </div>
      <div className="pos-receipts-detail-pane">
        {selected ? (
          <ReceiptPaper
            receipt={selected}
            onPrint={() => void handlePrint(selected)}
            onVoid={() => void handleVoid(selected)}
            voidBusy={voidBusy}
          />
        ) : (
          <p className="muted pos-module-empty">เลือกใบเสร็จจากรายการ</p>
        )}
      </div>
    </div>
  );
}
