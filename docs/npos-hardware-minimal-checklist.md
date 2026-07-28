# nPos — อุปกรณ์ขั้นต่ำ (ร้านชงชาหน้าบาร์)

อัปเดต: **1.14.65** · `APP_BUILD` 323 · `POS_BUILD` 118 · vc **88**

## ขอบเขต

ร้านเครื่องดื่มหน้าเคาน์เตอร์ — **ไม่มี** ปริ้นเตอร์ครัว / สแกนเนอร์ / โลโก้บนกระดาษ

| ข้อ | ทำ |
|-----|----|
| หน้าตั้งค่า | ส่วน **อุปกรณ์ · ปริ้นเตอร์ / ลิ้นชัก** (Settings) |
| ใบเสร็จ | USB / BT / LAN · กระดาษ **80 / 58** · Auto-print จาก BO |
| หัว–ท้ายสลิป | ชื่อ ที่อยู่ โทร · **เลขผู้เสียภาษี** · footer |
| ลิ้นชัก | เด้งเฉพาะเงินสด · hub **เปิดลิ้นชัก** (No Sale) + ops log |

```bash
node scripts/test-npos-hardware-minimal.mjs
node scripts/test-npos-doc-drawer-polish.mjs
node scripts/test-npos-receipt-parity.mjs
```
