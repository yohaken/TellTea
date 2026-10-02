"use client";

import { useState } from "react";
import type { LedgerEntry } from "@/lib/types";
import { formatThaiMonthKey } from "@/lib/vat-monthly";
import { formatPlainNumber } from "@/lib/utils";
import type { ReclassifyMonthProgress } from "@/lib/ledger-ai";

export type LedgerStatusKey = "ai" | "owner" | "guess" | "blank";

/** ผู้จัดประเภท — จาก typeSource ที่เก็บในแถว */
export function ledgerStatusOf(row: Pick<LedgerEntry, "typeSource" | "typeAiReason">): {
  key: LedgerStatusKey;
  label: string;
  title: string;
} {
  const raw = String(row.typeSource || "").trim().toLowerCase();
  const reason = String(row.typeAiReason || "").trim();
  if (raw === "ai") return { key: "ai", label: "AI", title: reason || "AI จัดประเภท" };
  if (raw === "owner") return { key: "owner", label: "จัดเอง", title: "เจ้าของจัดเอง — AI จะไม่ทับ" };
  if (raw === "heuristic") {
    return { key: "guess", label: "เดา", title: reason || "เดาจากชื่อรายการ (AI ไม่ตอบ) — ควรให้ AI จัดใหม่" };
  }
  if (raw.startsWith("payroll")) {
    return { key: "blank", label: "ว่าง", title: "ตั้งจากหน้าเงินเดือนตอนบันทึก" };
  }
  return { key: "blank", label: "ว่าง", title: "จัดไว้ตั้งแต่บันทึก (ไม่มีข้อมูลผู้จัด)" };
}

export function LedgerStatusBadge({ row }: { row: Pick<LedgerEntry, "typeSource" | "typeAiReason"> }) {
  const s = ledgerStatusOf(row);
  return (
    <span className={`ledger-status-badge is-${s.key}`} title={s.title}>
      {s.label}
    </span>
  );
}

export type LedgerRange = { from: string; to: string; label: string };

function lastDayOfMonth(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${monthKey}-${String(d).padStart(2, "0")}`;
}

/** เลือกช่วงจัดระเบียบ — เดือน+ปี หรือ จาก…ถึง (เจ้าของเท่านั้น) */
export function LedgerRangePicker({
  active,
  loading,
  onApply,
  onClear,
}: {
  active: LedgerRange | null;
  loading: boolean;
  onApply: (range: LedgerRange) => void;
  onClear: () => void;
}) {
  const [mode, setMode] = useState<"month" | "range">("month");
  const [month, setMonth] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const canApply = mode === "month" ? /^\d{4}-\d{2}$/.test(month) : Boolean(from && to);

  function apply() {
    if (!canApply) return;
    if (mode === "month") {
      onApply({ from: `${month}-01`, to: lastDayOfMonth(month), label: formatThaiMonthKey(month) });
      return;
    }
    const [a, b] = from <= to ? [from, to] : [to, from];
    onApply({ from: a, to: b, label: `${a} ถึง ${b}` });
  }

  return (
    <div className="ledger-range-picker" role="group" aria-label="ช่วงวันที่">
      <select
        value={mode}
        onChange={(e) => setMode(e.target.value as "month" | "range")}
        aria-label="แบบช่วง"
      >
        <option value="month">เดือน+ปี</option>
        <option value="range">ช่วง</option>
      </select>
      {mode === "month" ? (
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="เดือน" />
      ) : (
        <>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="จากวันที่" />
          <span className="muted">ถึง</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="ถึงวันที่" />
        </>
      )}
      <button type="button" className="ghost-btn bulk-status-btn" disabled={!canApply || loading} onClick={apply}>
        {loading ? "กำลังโหลด…" : "แสดง"}
      </button>
      {active ? (
        <button type="button" className="ghost-btn bulk-status-clear" disabled={loading} onClick={onClear}>
          กลับสด
        </button>
      ) : null}
    </div>
  );
}

export type ClosedMonthConfirm = {
  actionLabel: string;
  months: { key: string; count: number; amount: number }[];
  touchesOther: boolean;
};

/** ถามก่อนแก้ประเภทในงวด VAT ที่ยื่นแล้ว */
export function LedgerClosedMonthDialog({
  confirm,
  onCancel,
  onConfirm,
}: {
  confirm: ClosedMonthConfirm;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop edit-modal is-module-form" role="presentation" onClick={onCancel}>
      <div
        className="modal-card ledger-closed-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-label="แก้งบที่ปิดแล้ว"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="panel-title">แก้ย้อนไปงบที่ปิดแล้ว?</h2>
        <p className="ledger-closed-confirm-lead">
          {confirm.actionLabel} — มีรายการอยู่ในเดือนที่ยื่น VAT แล้ว:
        </p>
        <ul className="ledger-closed-confirm-months">
          {confirm.months.map((m) => (
            <li key={m.key}>
              <strong>{formatThaiMonthKey(m.key)}</strong> · {m.count} รายการ · ฿{formatPlainNumber(m.amount)}
            </li>
          ))}
        </ul>
        <ul className="muted ledger-closed-confirm-notes">
          <li>ยอด ต้นทุน / ค่าใช้จ่าย ใน P&amp;L และสรุปภาษีของเดือนเหล่านั้นจะเปลี่ยนตาม</li>
          <li>ภาษีซื้อ (ภ.พ.30) ไม่เปลี่ยน — ไม่ขึ้นกับประเภท</li>
          {confirm.touchesOther ? (
            <li>มีการย้ายเข้า/ออก สินทรัพย์ หรือ อื่นๆ — กำไรสุทธิใน P&amp;L จะเปลี่ยน (หน้า VAT นับ อื่นๆ เป็นค่าใช้จ่าย)</li>
          ) : null}
          <li>ไม่ปรับสต็อกย้อนหลัง · สถานะงวดยังเป็น «ยื่นแล้ว» เหมือนเดิม</li>
        </ul>
        <div className="ledger-closed-confirm-actions">
          <button type="button" className="ghost-btn" onClick={onCancel}>
            ยกเลิก
          </button>
          <button type="button" className="primary-btn" onClick={onConfirm}>
            ยืนยัน แก้งบเดือนที่ปิดแล้ว
          </button>
        </div>
      </div>
    </div>
  );
}

export function LedgerAiProgressLine({
  progress,
  onCancel,
}: {
  progress: ReclassifyMonthProgress;
  onCancel: () => void;
}) {
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="ledger-ai-progress" role="status">
      <div className="ledger-ai-progress-bar" aria-hidden>
        <span style={{ width: `${pct}%` }} />
      </div>
      <span className="ledger-ai-progress-text">
        AI จัด {progress.done}/{progress.total}
        {progress.currentDescription ? ` · ${progress.currentDescription}` : ""}
      </span>
      <button type="button" className="ghost-btn bulk-status-clear" onClick={onCancel}>
        หยุด
      </button>
    </div>
  );
}
