# nPos — แผงรอบขาย dashboard + ประวัติรอบ

อัปเดต: **1.14.57** · `APP_BUILD` 315 · `POS_BUILD` 110 · vc **80**

## สเปกที่ยืนยัน
- [x] Layout ซ้าย ~30% เมนูย่อย · ขวา ~70% การ์ดสรุป
- [x] 3 บล็อก: เงินสด · เงินโอน · สรุปรวม (ธีม TellTea)
- [x] แสดงพนักงาน + รหัสเครื่อง
- [x] ประวัติรอบขายบน native (local หลังปิดกะ)
- [x] ถอนเงิน · X-report · ปิดกะ (blind) คงเดิม
- [x] ไม่เพิ่ม dine-in / รับกลับ

## Sell chrome (คู่ขนาน)
- [x] ค้นหาเป็นไอคอนแว่น · กดแล้วเปิดช่อง
- [x] สัดส่วนหมวด/กริด/ตะกร้า ≈ 14 / 70 / 16

```bash
node scripts/test-npos-shift-dashboard.mjs
node scripts/test-npos-sell-table-pay.mjs
```
