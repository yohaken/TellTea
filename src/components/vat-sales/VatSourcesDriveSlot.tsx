"use client";

/**
 * ช่องว่างด้านล่างหน้าที่มา — แสดงจริงให้เช็ค / ให้เอเจนถัดไปต่อ
 * ยังไม่ซิงก์ Drive · ยังไม่มีรายการไฟล์
 * ดู docs/vat-delivery-drive-spine.md (F0–F5)
 */
import { MONTH_CHANNEL_LABEL, MONTH_CHANNELS } from "@/lib/vat-month-sources";
import { formatThaiMonthKey } from "@/lib/vat-monthly";

type Props = { monthKey: string };

const READY_CHECKS = [
  { id: "f0", label: "OAuth + scope Drive · ราก TellTea-VAT", ready: false },
  { id: "f1", label: "ซิงก์แนบเมล → Drive แยกแอพ/เดือน", ready: false },
  { id: "f2", label: "รายการไฟล์บนหน้านี้ + เปิดลิงก์", ready: false },
  { id: "f3", label: "Agent Dump ส่งลิงก์ไฟล์ให้ AI", ready: false },
] as const;

export function VatSourcesDriveSlot({ monthKey }: Props) {
  return (
    <section
      id="vat-sources-drive-slot"
      className="vat-table-block vat-sources-drive-slot"
      data-ai-context="vat-sources-drive-slot"
      data-drive-ready="0"
      data-month={monthKey}
      aria-label="ช่องไฟล์ Drive — ว่าง พร้อมเช็ค"
    >
      <h3 className="vat-table-subtitle">ไฟล์ Drive — ว่าง (พร้อมต่อ)</h3>
      <p className="muted vat-sales-hint vat-hint-one-line">
        เดือน {formatThaiMonthKey(monthKey)} · ยังไม่มีไฟล์บน Drive ·
        เอเจนถัดไปเติม F0–F2 ที่นี่
      </p>

      <ul className="vat-sources-drive-checks" aria-label="เช็คความพร้อม">
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
            <span>{c.label}</span>
            <span className="muted">{c.ready ? "พร้อม" : "ว่าง"}</span>
          </li>
        ))}
      </ul>

      <div className="sheet-wrap vat-month-slim-wrap">
        <table
          className="sheet-table vat-sales-table vat-sales-table--slim"
          data-drive-files="0"
        >
          <thead>
            <tr>
              <th className="col-seg">แอพ</th>
              <th>โฟลเดอร์</th>
              <th>ไฟล์</th>
              <th>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {MONTH_CHANNELS.map((ch) => (
              <tr key={ch} data-channel={ch} data-file-count="0">
                <td className="col-seg">{MONTH_CHANNEL_LABEL[ch]}</td>
                <td className="muted">
                  TellTea-VAT/{ch}/{monthKey}/
                </td>
                <td className="col-num">0</td>
                <td>
                  <span className="vat-sources-drive-empty">ว่าง</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <pre
        id="vat-sources-drive-handoff"
        className="vat-sources-drive-handoff"
        data-ai-notes="1"
      >{`# vat-sources-drive-slot · handoff
month=${monthKey}
driveReady=0
files=0
next=F0 OAuth drive.file + F1 sync attachments → Drive
doc=docs/vat-delivery-drive-spine.md
ui=#vat-sources-drive-slot
`}</pre>
    </section>
  );
}
