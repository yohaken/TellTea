# nPos / หลังร้าน — รายละเอียดเงินรอบ (เบิก + สรุปการ์ด)

อัปเดต: **ship O2 1.14.87** · pin ปัจจุบัน APK **1.14.89** · vc **112** · `APP_BUILD` 509 · `POS_BUILD` 141  
ดูเฟส [npos-counter-ops-phases.md](./npos-counter-ops-phases.md)  
อ้างอิง: [npos-void-cashout-reason-checklist.md](./npos-void-cashout-reason-checklist.md) · [npos-z-cash-remit-checklist.md](./npos-z-cash-remit-checklist.md) · [npos-bo-slim-sessions-checklist.md](./npos-bo-slim-sessions-checklist.md)

## เป้า
หลังปิดกะ เจ้าของเห็นเงินรอบละเอียดพอใช้ตรวจ โดยไม่ต้องเดาจากยอดรวมอย่างเดียว

## มีแล้ว vs ช่องว่าง

| ข้อมูล | เครื่อง | เซิร์ฟเวอร์ | โชว์ BO |
|--------|---------|-------------|---------|
| opening / counted / expected / diff / leaveFloat | ใช่ | ใช่ | ใช่ (expand) |
| cashOutTotal / cashDropCount | ใช่ | ใช่ | ใช่ |
| cashDropNotes[] (amount·reason·at) | ส่งแล้ว | **persist 1.14.87** | **ใช่** |
| discrepancyLabel | ใช่ | ใช่ | ใช่ |
| discountTotal / voidedCount บนรอบ | ใช่ | ใช่ | ใช่ (expand) |
| จำนวนบิลต่อวิธีจ่าย | ใช่ | ใช่ | ใช่ (expand) |
| ยอดนำส่ง (counted − leaveFloat) | คำนวณบน Z | **remitAmount** | ใช่ |

## งาน

### O2.1 Persist รายการเบิก
- [x] `nposSessionClose` เขียน `cashDropNotes` (sanitize ≤ 50)
- [x] ไม่ทำให้ปิดกะพังถ้า notes ว่าง

### O2.2 โมเดลหลังร้าน
- [x] `PosSession` + `mapSession`: notes · label · discount · voided · bill counts · remit

### O2.3 UI `/pos-sales`
- [x] Expand: รายการเบิก · ป้ายตรง/เกิน/ขาด · นำส่ง · ส่วนลด/void · บิลตามวิธีจ่าย

### O2.4 รับเงินเข้ากลางรอบ
- [x] **เลื่อนออกนอก O2** — มี `cashInTotal` แล้ว · UI รับเข้ากลางรอบทำทีหลังถ้าต้องการจริง

### O2.5 ตรวจ
- [x] Gate `scripts/test-npos-session-cash-detail.mjs`
- [ ] คนเทส: เบิก 2 ครั้ง → ปิดกะ → BO เห็น 2 บรรทัด
- [ ] คนเทส: ไม่มีเบิก → ปิดได้ · โซน notes ซ่อน

## ตรวจ
```bash
node scripts/test-npos-session-cash-detail.mjs
SKIP_CAPTURE_SMOKE=1 node scripts/check-npos-shop.mjs
```
