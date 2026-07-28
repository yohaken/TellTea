# nPos — BO sessions table slim super

อัปเดต: **1.14.66** · `APP_BUILD` 325 · `POS_BUILD` 119 · vc **89**

## มติ

| ข้อ | ทำ |
|-----|----|
| ไม่ใช้ date slider | ลบแถบเลื่อนวัน — โหลดรอบล่าสุด |
| 50 แถว + scroll | `subscribePosSessionsRecent(50)` · `.npos-slim-scroll--rows` สูงจำกัด |
| วันใหม่→เก่า | `sortSessionsByDateNewestFirst` · active แสดงยอดบิล realtime |
| สแกนผิดปกติ | `inspectPosSessionData` — วันที่เพี้ยน / เปิดค้าง / ยอด≠บิล |
| คอลัมน์วันที่ | แสดงวันของรอบ |
| คอลัมน์รวม | เวลารวมของรอบ (เปิด = ถึงตอนนี้) |
| กลุ่มรหัส (เจ้าของร้าน) | **เครื่อง** (pairing) · **รหัสรอบ** — รหัสรอบซ่อนเมื่อจอแคบ |
| คอลัมน์ปิด | เวลา `closedAt` |
| ปิดรอบจาก BO (ทดลอง) | คอลัมน์ **ปิด** · `closePosSessionAdmin` · แท็บเล็ตตาม heartbeat (ไม่เตะ seat) · ดู `npos-bo-close-sync-checklist` |
| ปิดกะเร็ว | ไม่รอ heartbeat / ไม่บล็อกด้วย pending dialog · flush แล้ว `nposSessionClose` ก่อนออกงานในเครื่อง |
| หลังปิดต้องขึ้นตาราง | ปิด local เฉพาะเมื่อเซิร์ฟเวอร์ `ok` · CF ซ่อม `date` Bangkok |

## ตรวจ

```bash
node scripts/test-npos-bo-slim-sessions.mjs
node scripts/test-npos-blind-shift-close.mjs
node scripts/test-npos-bo-sessions-super.mjs
node scripts/test-npos-bo-bills-slim.mjs
node scripts/test-npos-transfer-cart-bo.mjs
```
