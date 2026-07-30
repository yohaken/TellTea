# nPos / หลังร้าน — รายละเอียดเงินรอบ (เบิก + สรุปการ์ด)

อัปเดต: **แผน O2** · ดูเฟส [npos-counter-ops-phases.md](./npos-counter-ops-phases.md)  
อ้างอิง: [npos-void-cashout-reason-checklist.md](./npos-void-cashout-reason-checklist.md) · [npos-z-cash-remit-checklist.md](./npos-z-cash-remit-checklist.md) · [npos-bo-slim-sessions-checklist.md](./npos-bo-slim-sessions-checklist.md)

## เป้า
หลังปิดกะ เจ้าของเห็นเงินรอบละเอียดพอใช้ตรวจ โดยไม่ต้องเดาจากยอดรวมอย่างเดียว

## มีแล้ว vs ช่องว่าง

| ข้อมูล | เครื่อง | เซิร์ฟเวอร์ | โชว์ BO |
|--------|---------|-------------|---------|
| opening / counted / expected / diff / leaveFloat | ใช่ | ใช่ | ใช่ (expand) |
| cashOutTotal / cashDropCount | ใช่ | ใช่ | บางส่วน |
| cashDropNotes[] (amount·reason·at) | ส่งแล้ว | **ยังไม่ persist** | ไม่ |
| discrepancyLabel | ส่ง/เก็บได้ | บางส่วน | ไม่โชว์ |
| discountTotal / voidedCount บนรอบ | มีทางส่ง | บางส่วน | ไม่บนการ์ด |
| จำนวนบิลต่อวิธีจ่าย | มีใน Z local | ยังไม่ครบใน close body | ไม่ |
| ยอดนำส่ง (counted − leaveFloat) | คำนวณบน Z | ไม่เก็บเป็นฟิลด์ | ไม่ |

## งาน

### O2.1 Persist รายการเบิก
- [ ] `nposSessionClose` เขียน `cashDropNotes` เป็น array บน `posSessions`
- [ ] จำกัดขนาดสมเหตุสมผล (เช่น ≤ 50 รายการ / เหตุผลสั้น)
- [ ] ไม่ทำให้ปิดกะพังถ้า notes ว่าง

### O2.2 โมเดลหลังร้าน
- [ ] ขยาย `PosSession` + `mapSession`
- [ ] ฟิลด์: notes · discrepancyLabel · discountTotal · voidedCount · cashBillCount / ppBillCount / transferBillCount · remitAmount (หรือคำนวณตอนแสดง)

### O2.3 UI `/pos-sales`
- [ ] Expand รอบ: รายการเบิก (เวลา · จำนวน · เหตุผล)
- [ ] ป้าย ตรง / เกิน / ขาด
- [ ] แถวสรุป: ส่วนลดรอบ · void · ยอดนำส่ง
- [ ] (ทางเลือก) คอลัมน์สั้นบนตารางหลักโดยไม่ต้อง expand

### O2.4 รับเงินเข้ากลางรอบ (ถ้าทำใน O2)
- [ ] UI บน native บันทึก cash-in + เหตุผล
- [ ] สะท้อนใน Z และ session close
- [ ] ถ้ายังไม่จำเป็น → เลื่อนออกนอก O2 ชัดเจน

### O2.5 ตรวจ
- [ ] Gate สคริปต์
- [ ] คนเทส: เบิก 2 ครั้ง → ปิดกะ → BO เห็น 2 บรรทัด
- [ ] คนเทส: ไม่มีเบิก → ปิดได้ · โซน notes ว่าง/ซ่อน

## ตรวจ
```bash
node scripts/test-npos-counter-ops-phases.mjs
# หลังลงมือ: node scripts/test-npos-session-cash-detail.mjs
```
