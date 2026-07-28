# nPos — BO sessions table slim super

อัปเดต: **1.14.63** · `APP_BUILD` 321 · `POS_BUILD` 116 · vc **86**

## มติ

| ข้อ | ทำ |
|-----|----|
| ไม่ใช้ date slider | ลบแถบเลื่อนวัน — โหลดรอบล่าสุด |
| 50 แถว + scroll | `subscribePosSessionsRecent(50)` · `.npos-slim-scroll--rows` สูงจำกัด |
| ใหม่สุดขึ้นบน | `sortSessionsNewestFirst` (closedAt \|\| openedAt) |
| คอลัมน์วันที่ | แสดงวันของรอบ |
| กลุ่มรหัส (เจ้าของร้าน) | **เครื่อง** (pairing) · **รหัสรอบ** — รหัสรอบซ่อนเมื่อจอแคบ |
| คอลัมน์ปิด | เวลา `closedAt` |
| ปิดรอบจาก BO (ทดลอง) | คอลัมน์ **ปิด** · `closePosSessionAdmin` · ไม่แทนที่การปิดกะบนแท็บเล็ต |
| ปิดกะเร็ว | ไม่รอ heartbeat / ไม่บล็อกด้วย pending dialog · flush แล้ว `nposSessionClose` ก่อนออกงานในเครื่อง |
| หลังปิดต้องขึ้นตาราง | ปิด local เฉพาะเมื่อเซิร์ฟเวอร์ `ok` · CF ซ่อม `date` Bangkok |

## ตรวจ

```bash
node scripts/test-npos-bo-slim-sessions.mjs
node scripts/test-npos-blind-shift-close.mjs
node scripts/test-npos-bo-sessions-super.mjs
node scripts/test-npos-bo-bills-slim.mjs
```
