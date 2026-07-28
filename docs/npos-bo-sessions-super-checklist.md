# nPos — BO sessions table slim super

อัปเดต: **1.14.61** · `APP_BUILD` 319 · `POS_BUILD` 114 · vc **84**

## มติ

| ข้อ | ทำ |
|-----|----|
| ไม่ใช้ date slider | ลบแถบเลื่อนวัน — โหลดรอบล่าสุด |
| 50 แถว + scroll | `subscribePosSessionsRecent(50)` · `.npos-slim-scroll--rows` สูงจำกัด |
| ใหม่สุดขึ้นบน | `sortSessionsNewestFirst` (closedAt \|\| openedAt) |
| คอลัมน์วันที่ | แสดงวันของรอบ |
| กลุ่มรหัส (เจ้าของร้าน) | **รหัสเครื่อง** (pairing) · **รหัสรอบ** — ไม่ซ่อน |
| คอลัมน์ปิด | เวลา `closedAt` |
| ปิดกะเร็ว | ไม่รอ heartbeat / ไม่บล็อกด้วย pending dialog · flush แล้ว `nposSessionClose` ก่อนออกงานในเครื่อง |
| หลังปิดต้องขึ้นตาราง | ปิด local เฉพาะเมื่อเซิร์ฟเวอร์ `ok` · CF ซ่อม `date` Bangkok |

## ตรวจ

```bash
node scripts/test-npos-bo-slim-sessions.mjs
node scripts/test-npos-blind-shift-close.mjs
node scripts/test-npos-bo-sessions-super.mjs
```
