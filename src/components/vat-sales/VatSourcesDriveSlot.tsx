"use client";

/**
 * ช่องไฟล์ Drive ด้านล่างหน้าที่มา — แสดงเช็คลิสต์ F0–F5 + กล่องแยกแอพ
 * ยังไม่ซิงก์ Drive · ยังไม่มีรายการไฟล์
 * ดู docs/vat-delivery-drive-spine.md
 */
import { MONTH_CHANNEL_LABEL, MONTH_CHANNELS } from "@/lib/vat-month-sources";
import { formatThaiMonthKey } from "@/lib/vat-monthly";
import type { MonthChannel } from "@/lib/vat-month-books";

type Props = { monthKey: string };

const READY_CHECKS = [
  { id: "f0", label: "OAuth + scope Drive · ราก TellTea-VAT", ready: false },
  { id: "f1", label: "ซิงก์แนบเมล → Drive แยกแอพ/เดือน", ready: false },
  { id: "f2", label: "รายการไฟล์บนหน้านี้ + เปิดลิงก์", ready: false },
  { id: "f3", label: "Agent Dump ส่งลิงก์ไฟล์ให้ AI", ready: false },
  { id: "f4", label: "AI อ่านไฟล์ → ร่างยอดเดือน", ready: false },
  { id: "f5", label: "Owner ยืนยัน → ลงตารางยอดเดลิเวอรี่", ready: false },
] as const;

const CHANNEL_FOLDER: Record<MonthChannel, string> = {
  grab: "grab",
  lineman: "lineman",
  shopee: "shopee",
};

export function VatSourcesDriveSlot({ monthKey }: Props) {
  const readyCount = READY_CHECKS.filter((c) => c.ready).length;

  return (
    <section
      id="vat-sources-drive-slot"
      className="vat-table-block vat-sources-drive-slot"
      data-ai-context="vat-sources-drive-slot"
      data-drive-ready={String(readyCount)}
      data-month={monthKey}
      aria-label="ช่องไฟล์ Drive — เช็คลิสต์และกล่องแอพ"
    >
      <h3 className="vat-table-subtitle">ไฟล์ Drive — แยกแอพ</h3>
      <p className="muted vat-sales-hint vat-hint-one-line">
        เดือน {formatThaiMonthKey(monthKey)} · ยังไม่มีไฟล์บน Drive ·
        ดึงเมล → เก็บ TellTea-VAT/แอพ/เดือน → อ่านไฟล์ทีหลัง
      </p>

      <ul className="vat-sources-drive-checks" aria-label="เช็คลิสต์ Drive F0–F5">
        {READY_CHECKS.map((c) => (
          <li
            key={c.id}
            className="vat-sources-drive-check"
            data-check={c.id}
            data-ready={c.ready ? "1" : "0"}
          >
            <span className="vat-sources-drive-mark" aria-hidden="true">
              {c.ready ? "✓" : "○"}
            </span>
            <span>
              <span className="vat-sources-drive-phase">{c.id.toUpperCase()}</span>{" "}
              {c.label}
            </span>
            <span className="muted">{c.ready ? "พร้อม" : "ว่าง"}</span>
          </li>
        ))}
      </ul>

      <div
        className="vat-sources-drive-boxes"
        data-drive-files="0"
        aria-label="กล่องไฟล์แยกแอพ"
      >
        {MONTH_CHANNELS.map((ch) => {
          const folder = `TellTea-VAT/${CHANNEL_FOLDER[ch]}/${monthKey}/`;
          return (
            <article
              key={ch}
              className="vat-sources-drive-box"
              data-channel={ch}
              data-file-count="0"
            >
              <header className="vat-sources-drive-box-head">
                <h4 className="vat-sources-drive-box-title">
                  {MONTH_CHANNEL_LABEL[ch]}
                </h4>
                <span className="vat-sources-drive-empty">ว่าง · 0 ไฟล์</span>
              </header>
              <p className="muted vat-sources-drive-path">{folder}</p>
              <ul className="vat-sources-drive-file-list">
                <li className="muted vat-sources-drive-file-empty">
                  ยังไม่มีไฟล์ — รอซิงก์ Drive (F1)
                </li>
              </ul>
            </article>
          );
        })}
      </div>

      <pre
        id="vat-sources-drive-handoff"
        className="vat-sources-drive-handoff"
        data-ai-notes="1"
      >{`# vat-sources-drive-slot · handoff
month=${monthKey}
driveReady=${readyCount}/6
files=0
checks=F0–F5 ว่างทั้งหมด
next=F0 OAuth drive.file + F1 sync attachments → Drive
doc=docs/vat-delivery-drive-spine.md
ui=#vat-sources-drive-slot
`}</pre>
    </section>
  );
}
