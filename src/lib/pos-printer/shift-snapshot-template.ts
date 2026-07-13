import { formatPlainNumber } from "../utils";
import { escapeReceiptHtml } from "./receipt-template";
import type { ShiftReportPayload } from "../pos-shift-report";

function formatTs(ts: number) {
  return new Date(ts).toLocaleString("th-TH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function money(n: number) {
  return formatPlainNumber(n);
}

/** ใบพิมพ์สรุปกะ — Snapshot กลางรอบ / รายงานปิดรอบ (Phase 1) */
export function buildShiftReportHtml(data: ShiftReportPayload): string {
  const title =
    data.kind === "snapshot" ? "Snapshot ระหว่างรอบการขาย" : "รายงานยอดการขาย";
  const footer =
    data.kind === "snapshot" ? "*** ไม่ใช่การปิดรอบ ***" : "ปิดรอบเรียบร้อย";
  const sessionShort = `#${data.sessionId.slice(-4).toUpperCase()}`;
  const s = data.summary;

  const closedBlock =
    data.kind === "close" && data.closedAt
      ? `<div class="row"><span>ปิดรอบ</span><span>${escapeReceiptHtml(formatTs(data.closedAt))}</span></div>`
      : "";

  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <title>${escapeReceiptHtml(title)} ${escapeReceiptHtml(sessionShort)}</title>
  <style>
    @page { size: 80mm auto; margin: 4mm; }
    body {
      margin: 0;
      font-family: "Courier New", ui-monospace, monospace;
      font-size: 12px;
      color: #111;
      width: 72mm;
    }
    .center { text-align: center; }
    .shop { font-weight: 800; font-size: 14px; }
    .muted { color: #444; }
    .rule { border: 0; border-top: 1px dashed #222; margin: 8px 0; }
    .row {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      margin: 2px 0;
    }
    .pay {
      width: 100%;
      border-collapse: collapse;
      margin: 4px 0;
    }
    .pay th, .pay td {
      padding: 2px 0;
      text-align: right;
      font-weight: 600;
    }
    .pay th:first-child, .pay td:first-child { text-align: left; }
    .pay .sum td { border-top: 1px dashed #222; padding-top: 4px; font-weight: 800; }
    .footer { margin-top: 10px; font-weight: 800; letter-spacing: 0.02em; }
  </style>
</head>
<body>
  <div class="center shop">${escapeReceiptHtml(data.shopName)}</div>
  ${data.shopNameTh ? `<div class="center muted">${escapeReceiptHtml(data.shopNameTh)}</div>` : ""}
  ${data.shopAddress ? `<div class="center muted">${escapeReceiptHtml(data.shopAddress)}</div>` : ""}
  ${data.shopPhone ? `<div class="center muted">${escapeReceiptHtml(data.shopPhone)}</div>` : ""}
  <hr class="rule" />
  <div class="center" style="font-weight:800">${escapeReceiptHtml(title)}</div>
  <div class="center muted">${escapeReceiptHtml(formatTs(data.printedAt))}</div>
  <div class="row"><span>รหัสเครื่อง</span><span>${escapeReceiptHtml(data.deviceCode)} · รอบ ${escapeReceiptHtml(sessionShort)}</span></div>
  <div class="row"><span>เปิดรอบ</span><span>${escapeReceiptHtml(formatTs(data.openedAt))}</span></div>
  ${closedBlock}
  ${data.staffName ? `<div class="row"><span>โดย</span><span>${escapeReceiptHtml(data.staffName)}</span></div>` : ""}
  <hr class="rule" />
  <div style="font-weight:800;margin-bottom:4px">ยอดขายตามการชำระเงิน</div>
  <table class="pay">
    <thead>
      <tr><th>ช่องทาง</th><th>บิล</th><th>ยอด</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>เงินสด</td>
        <td>${s.cashCount}</td>
        <td>${money(s.cashTotal)}</td>
      </tr>
      <tr>
        <td>PromptPay</td>
        <td>${s.promptpayCount}</td>
        <td>${money(s.promptpayTotal)}</td>
      </tr>
      <tr class="sum">
        <td>รวม</td>
        <td>${s.count}</td>
        <td>${money(s.total)}</td>
      </tr>
    </tbody>
  </table>
  <hr class="rule" />
  <div class="row"><span>บิลทั้งหมด</span><span>${s.count}</span></div>
  <div class="row"><span>ทำลายบิล</span><span>${s.voidedCount}</span></div>
  <div class="row"><span>บิลรอส่ง</span><span>${s.pendingCount}</span></div>
  <div class="center footer">${escapeReceiptHtml(footer)}</div>
  <script>window.onload=function(){window.print();setTimeout(function(){window.close();},300);};</script>
</body>
</html>`;
}

export function openShiftReportPrint(html: string): boolean {
  if (typeof window === "undefined" || typeof window.print !== "function") return false;
  const win = window.open("", "_blank", "width=360,height=720");
  if (!win) return false;
  win.document.write(html);
  win.document.close();
  return true;
}
