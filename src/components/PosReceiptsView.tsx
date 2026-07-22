"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PosReceiptPaper } from "@/components/PosReceiptPaper";
import { seedDemoLocalReceipts, seedDemoLocalReceiptsIfEmpty } from "@/lib/pos-demo-receipts";
import {
  listLocalReceiptsForDay,
  voidLocalReceipt,
  type PosLocalReceipt,
} from "@/lib/pos-local-receipts";
import { printSaleDocuments } from "@/lib/pos-printer/router";
import { localReceiptToPrintPayload } from "@/lib/pos-receipt-view";
import { getLocalPosShopSettings, subscribePosShopSettings, type PosShopSettings } from "@/lib/pos-settings";
import { usePosApp } from "@/lib/pos-app-context";
import { formatPlainNumber, startOfLocalDay } from "@/lib/utils";
import { PosConfirmDialog } from "@/components/PosConfirmDialog";

type ReceiptFilter = "all" | "pending" | "synced";

const DEFAULT_SHOP: PosShopSettings = getLocalPosShopSettings();

export function PosReceiptsView() {
  const dayStart = startOfLocalDay();
  const { session } = usePosApp();
  const [rows, setRows] = useState(() => listLocalReceiptsForDay(dayStart));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<ReceiptFilter>("all");
  const [shop, setShop] = useState<PosShopSettings>(DEFAULT_SHOP);
  const [voidBusy, setVoidBusy] = useState(false);
  const [voidTarget, setVoidTarget] = useState<PosLocalReceipt | null>(null);
  const [voidReason, setVoidReason] = useState("");
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

  function openVoidDialog(receipt: PosLocalReceipt) {
    setVoidReason("");
    setVoidTarget(receipt);
  }

  async function confirmVoid() {
    if (!voidTarget) return;
    setVoidBusy(true);
    try {
      voidLocalReceipt(voidTarget.id, voidReason.trim() || undefined);
      setVoidTarget(null);
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
          <PosReceiptPaper
            receipt={selected}
            onPrint={() => void handlePrint(selected)}
            onVoid={() => openVoidDialog(selected)}
            voidBusy={voidBusy}
          />
        ) : (
          <p className="muted pos-module-empty">เลือกใบเสร็จจากรายการ</p>
        )}
      </div>

      <PosConfirmDialog
        open={voidTarget !== null}
        title={voidTarget ? `ทำลายบิล #${voidTarget.billNo}?` : ""}
        variant="prompt"
        promptLabel="เหตุผล"
        promptPlaceholder="ไม่บังคับ"
        promptValue={voidReason}
        onPromptChange={setVoidReason}
        confirmLabel="ทำลายบิล"
        destructive
        busy={voidBusy}
        onCancel={() => setVoidTarget(null)}
        onConfirm={() => void confirmVoid()}
      />
    </div>
  );
}
