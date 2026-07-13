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

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function money(n: number) {
  return formatPlainNumber(n);
}

function payLabel(method: "cash" | "promptpay") {
  return method === "cash" ? "สด" : "PP";
}

/** ใบพิมพ์สรุปกะ — Snapshot / รายงานปิดรอบ (แยกหมวด + รายบิล) */
export function buildShiftReportHtml(data: ShiftReportPayload): string {
  const title =
    data.kind === "snapshot" ? "Snapshot ระหว่างรอบการขาย" : "รายงานยอดการขาย";
  const footer =
    data.kind === "snapshot" ? "*** ไม่ใช่การปิดรอบ ***" : "ปิดรอบเรียบร้อย";
  const sessionShort = `#${data.sessionId.slice(-4).toUpperCase()}`;
  const s = data.summary;
  const d = data.detail;

  const closedBlock =
    data.kind === "close" && data.closedAt
      ? `<div class="row"><span>ปิดรอบ</span><span>${escapeReceiptHtml(formatTs(data.closedAt))}</span></div>`
      : "";

  const categoryBlock = d?.byCategory?.length
    ? `<hr class="rule" />
  <div class="sec">ยอดขายตามหมวดหมู่</div>
  <table class="pay">
    <thead><tr><th>หมวด</th><th>จำนวน</th><th>ยอด</th></tr></thead>
    <tbody>
      ${d.byCategory
        .map(
          (row) => `<tr>
        <td>${escapeReceiptHtml(row.name)}</td>
        <td>${row.qty}</td>
        <td>${money(row.amount)}</td>
      </tr>`,
        )
        .join("")}
      <tr class="sum">
        <td>รวม</td>
        <td>${d.itemQty}</td>
        <td>${money(d.grossSales)}</td>
      </tr>
    </tbody>
  </table>`
    : "";

  const totalsBlock = d
    ? `<hr class="rule" />
  <div class="sec">สรุปยอด</div>
  <div class="row"><span>ยอดขายรวม</span><span>${money(d.grossSales)}</span></div>
  <div class="row"><span>ส่วนลด</span><span>-${money(d.discountTotal)}</span></div>
  <div class="row"><span>ค่าบริการ</span><span>${money(0)}</span></div>
  <div class="row"><span>ยอดก่อนภาษี</span><span>${money(d.netSales)}</span></div>
  <div class="row"><span>ภาษี (VAT 0%)</span><span>${money(0)}</span></div>
  <div class="row"><span>ปัดเศษ</span><span>${money(0)}</span></div>
  <div class="row strong"><span>ยอดขายสุทธิ</span><span>${money(d.netSales)}</span></div>
  <div class="row"><span>จำนวนลูกค้า</span><span>${d.customerCount}</span></div>
  <div class="row"><span>ยอดเฉลี่ยต่อบิล</span><span>${money(d.avgPerBill)}</span></div>`
    : "";

  const discountBlock =
    d && d.discountCount > 0
      ? `<hr class="rule" />
  <div class="sec">ส่วนลด &amp; โปรโมชั่น</div>
  <div class="row"><span>ส่วนลดท้ายบิล</span><span>${d.discountCount} ครั้ง · -${money(d.discountTotal)}</span></div>`
      : d
        ? `<hr class="rule" />
  <div class="sec">ส่วนลด &amp; โปรโมชั่น</div>
  <div class="row"><span>ส่วนลดท้ายบิล</span><span>0 · ${money(0)}</span></div>`
        : "";

  const itemBlock =
    d?.byItem?.length
      ? `<hr class="rule" />
  <div class="sec">ยอดขายตามรายการ</div>
  <table class="pay">
    <thead><tr><th>รายการ</th><th>จำนวน</th><th>ยอด</th></tr></thead>
    <tbody>
      ${d.byItem
        .map(
          (row) => `<tr>
        <td>${escapeReceiptHtml(row.name)}</td>
        <td>${row.qty}</td>
        <td>${money(row.amount)}</td>
      </tr>`,
        )
        .join("")}
    </tbody>
  </table>`
      : "";

  const orderTypeBlock = d
    ? `<hr class="rule" />
  <div class="sec">ยอดขายตามประเภทออเดอร์</div>
  <div class="row"><span>ทานที่ร้าน</span><span>${d.dineInCount} · ${money(d.dineInTotal)}</span></div>`
    : "";

  const cashRoundBlock = `<hr class="rule" />
  <div class="sec">รอบการขาย (เงินสด)</div>
  <div class="row"><span>เงินสดเริ่มต้น</span><span>—</span></div>
  <div class="row"><span>ยอดขายเงินสด</span><span>${money(s.cashTotal)}</span></div>
  <div class="row"><span>คืนเงิน</span><span>${money(0)}</span></div>
  <div class="row"><span>เงินเข้า/เงินออก</span><span>${money(0)}</span></div>
  <div class="row"><span>ควรมีในลิ้นชัก*</span><span>${money(s.cashTotal)}</span></div>
  <div class="row"><span>นับจริงในลิ้นชัก</span><span>—</span></div>
  <div class="row"><span>ส่วนต่าง</span><span>—</span></div>
  <div class="muted tiny">*ยังไม่รวมเงินทอนเริ่มต้น (จะเพิ่มตอนเปิดกะ)</div>`;

  const voidBlock = d
    ? `<hr class="rule" />
  <div class="sec">ทำลายบิล / ยกเลิก</div>
  <div class="row"><span>ทำลายทั้งบิล</span><span>${s.voidedCount} · ${money(d.voidedTotal)}</span></div>
  <div class="row"><span>ทำลายรายเมนู</span><span>0 · ${money(0)}</span></div>
  <div class="row"><span>ยกเลิกบิล</span><span>0 · ${money(0)}</span></div>
  ${
    d.voidedBills.length
      ? d.voidedBills
          .map(
            (b) =>
              `<div class="bill-head void">#${escapeReceiptHtml(b.billNo)} ${escapeReceiptHtml(formatTime(b.createdAt))} · ${money(b.total)}</div>`,
          )
          .join("")
      : ""
  }`
    : `<hr class="rule" />
  <div class="row"><span>ทำลายบิล</span><span>${s.voidedCount}</span></div>`;

  const billsBlock =
    d?.bills?.length
      ? `<hr class="rule" />
  <div class="sec">รายการขายแยกตามบิล (${d.bills.length})</div>
  ${d.bills
    .map((b) => {
      const linesHtml =
        b.lines.length > 0
          ? b.lines
              .map((line) => {
                const opt = line.optionText
                  ? `<div class="opt">${escapeReceiptHtml(line.optionText)}</div>`
                  : "";
                return `<div class="line">
            <div class="line-row"><span>${escapeReceiptHtml(line.name)} ×${line.qty}</span><span>${money(line.amount)}</span></div>
            ${opt}
          </div>`;
              })
              .join("")
          : `<div class="muted tiny">ไม่มีรายการรายละเอียด</div>`;
      const disc =
        b.discountBaht > 0
          ? `<div class="line-row muted"><span>ส่วนลด</span><span>-${money(b.discountBaht)}</span></div>`
          : "";
      const pending = b.pending ? " · รอส่ง" : "";
      return `<div class="bill">
        <div class="bill-head">#${escapeReceiptHtml(b.billNo)} · ${escapeReceiptHtml(formatTime(b.createdAt))} · ${payLabel(b.paymentMethod)}${pending}</div>
        ${linesHtml}
        ${disc}
        <div class="line-row strong"><span>รวมบิล</span><span>${money(b.total)}</span></div>
      </div>`;
    })
    .join("")}`
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
    .tiny { font-size: 10px; margin: 2px 0 0; }
    .rule { border: 0; border-top: 1px dashed #222; margin: 8px 0; }
    .sec { font-weight: 800; margin: 0 0 4px; }
    .row {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      margin: 2px 0;
    }
    .row.strong, .line-row.strong { font-weight: 800; }
    .pay {
      width: 100%;
      border-collapse: collapse;
    }
    .pay th, .pay td {
      padding: 2px 0;
      text-align: right;
      font-weight: 600;
      vertical-align: top;
    }
    .pay th:first-child, .pay td:first-child { text-align: left; }
    .pay .sum td { border-top: 1px dashed #222; padding-top: 4px; font-weight: 800; }
    .bill { margin: 6px 0 8px; }
    .bill-head { font-weight: 800; margin-bottom: 2px; }
    .bill-head.void { color: #666; text-decoration: line-through; }
    .line { margin: 1px 0 2px 4px; }
    .line-row {
      display: flex;
      justify-content: space-between;
      gap: 6px;
    }
    .opt { font-size: 10px; color: #444; margin-left: 2px; }
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
  <div class="center muted">พิมพ์ ${escapeReceiptHtml(formatTs(data.printedAt))}</div>
  <div class="row"><span>รหัสเครื่อง</span><span>${escapeReceiptHtml(data.deviceCode)} · รอบ ${escapeReceiptHtml(sessionShort)}</span></div>
  <div class="row"><span>เปิดรอบ</span><span>${escapeReceiptHtml(formatTs(data.openedAt))}</span></div>
  ${closedBlock}
  ${data.staffName ? `<div class="row"><span>โดย</span><span>${escapeReceiptHtml(data.staffName)}</span></div>` : ""}
  ${categoryBlock}
  ${totalsBlock}
  ${discountBlock}
  <hr class="rule" />
  <div class="sec">ยอดขายตามการชำระเงิน</div>
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
        <td>ยอดขายสุทธิ</td>
        <td>${s.count}</td>
        <td>${money(s.total)}</td>
      </tr>
    </tbody>
  </table>
  ${orderTypeBlock}
  ${cashRoundBlock}
  ${voidBlock}
  <div class="row"><span>บิลรอส่ง</span><span>${s.pendingCount}</span></div>
  ${itemBlock}
  ${billsBlock}
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
