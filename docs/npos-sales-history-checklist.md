# nPos — ประวัติการขาย / ใบเสร็จ (เคาน์เตอร์ + BO)

อัปเดต: **1.14.42** · `APP_BUILD` 300 · `POS_BUILD` 95 · vc **65**  
มติ: เคาน์เตอร์ขาเร็ว · ไม่ทำ CRM / VAT / บัตร / refund / digital receipt / dine-in

## นโยบาย (คงจาก receipt-history-staff)

| ทำได้ | หมายเหตุ |
|--------|----------|
| ดูรายการ + ยอด + ชำระ | เครื่อง local |
| พิมพ์ซ้ำ | ไม่ต้อง PIN |
| ทำลายบิล + เหตุผล | ไม่ต้อง PIN |
| BO ดูรายละเอียดบิล | ✅ รอบนี้ |
| BO พิมพ์ / แก้บิลเก่า | ❌ |
| ค้นหาลูกค้า·เบอร์ · refund · บัตร · VAT · SMS | ❌ นอกสcope |

## H0 Native — list + detail + กรองเวลา

- [x] แยกซ้ายรายการ / ขวารายละเอียด (tablet landscape)
- [x] กรอง **รอบนี้** / **วันนี้** / **ล่าสุด**
- [x] รายละเอียด: เลขบิล · เวลา · พนักงาน · ชำระ · รายการ+ออปชัน · รวม/ส่วนลด/สุทธิ · รับ/ทอน (สด)
- [x] ปุ่มพิมพ์ซ้ำ · ทำลาย บน pane รายละเอียด
- [x] บิลทำลายแล้ว: ดูได้ · พิมพ์ไม่ได้

## H1 Native — กรองสถานะ / ชำระ / ค้นหาเลขบิล

- [x] สถานะ: ทั้งหมด · ปกติ · ทำลาย · รอส่ง
- [x] ชำระ: ทั้งหมด · สด · PromptPay
- [x] ค้นหาเลขบิล (substring)

## H2 BO `/pos-sales/` — รายละเอียดบิล

- [x] แตะแถวบิล → แสดงรายละเอียด (reuse `PosReceiptPaper`)
- [x] ไม่มีปุ่มพิมพ์จาก BO
- [x] void วันนี้ยังทำได้จากรายละเอียดหรือแถว

## นอกสcope (ยืนยัน)

- custom date range · PIN · digital receipt · customer search · refund · card · VAT/service · dine-in badge

## ตรวจ

```bash
node scripts/test-npos-sales-history.mjs
node scripts/test-npos-friendly-ui.mjs
```
