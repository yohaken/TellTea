# nPos — BO slim sessions filters + compact fold

อัปเดต: **1.14.61** · ต่อด้วย **table slim super** (`docs/npos-bo-sessions-super-checklist.md`)

## มติ

| ข้อ | ทำแล้ว |
|-----|--------|
| ใหม่สุดขึ้นบน | `sortSessionsNewestFirst` |
| แตะแถว → กรองบิลรอบนั้น | + scroll ไปรายการบิล |
| ตัวกรองบาง | ล่าสุด · เปิดอยู่ · เครื่อง — ไม่มี date slider |
| แถบสรุปหนึ่งบรรทัด | ยอด · บิล · ทำลาย · สด/โอน/PP |
| ไม่มีปุ่มปิดกะในตาราง | ปิดกะที่ native เท่านั้น |
| ลิ้นชัก/ส่วนต่าง | แผงขยายเมื่อแตะแถว |
| รหัส + วันที่ + ปิด | ดู checklist super |

## ตรวจ

```bash
node scripts/test-npos-bo-slim-sessions.mjs
node scripts/test-npos-bo-sessions-super.mjs
```
