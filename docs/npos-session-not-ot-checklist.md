# nPos — รายงานยอดขายใช้รอบ nPos จริง (ไม่ใช่กะ OT)

อัปเดต: **1.14.53** · `APP_BUILD` 311 · `POS_BUILD` 106 · vc **76**

## มติ

| ผิด | ถูก |
|-----|-----|
| กะ OT เช้า/เย็น/ดึก เป็นคอลัมน์/ตัวกรอง/สรุป | รอบขาย = `posSessions` (เปิด–ปิดมือบนแท็บเล็ต) |
| `orderBy("shift")` | subscribe ตาม `date` แล้วเรียงเปิดอยู่ก่อน · ปิดล่าสุดก่อน |
| แยกตามกะ OT ใน fold | แยกตาม `sessionId` |
| ปิดรอบไม่เก็บถอนกลางกะ | CF `nposSessionClose` บันทึก `cashOutTotal` / `cashInTotal` / `cashDropCount` |

ข้อมูลแถวระหว่างกะ: ยอด/บิลจาก `posSales` + ตัวนับ session realtime  
ลิ้นชัก/ส่วนต่าง/ถอน: แผงขยายเมื่อแตะ · ถอนเต็มหลังปิดรอบ (หลัง 1.14.53)

## ตรวจ

```bash
node scripts/test-npos-session-not-ot.mjs
```
