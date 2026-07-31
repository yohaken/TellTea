# nPos — BO POS hub (ยอดขาย + จัดการ หน้าเดียว)

อัปเดต: **APP_BUILD** 545 · **POS_BUILD** 157

## มติ

| ข้อ | ทำ |
|-----|-----|
| หน้าเดียว | `/pos-sales/` แสดง **ยอดขาย** แล้วตามด้วย **จัดการ** — ไม่สลับแท็บถอด DOM |
| ข้ามหมวด | ปุ่มหัวข้อเลื่อนไป `#pos-sales-report` / `#pos-manage` · `?tab=manage` ยังใช้ได้ |
| UI | mini compact slim · หัวข้อเล็ก · แถว nowrap · ตารางย่อ · ข้อความแนะนำสั้น |
| จัดการ | **3 หมวด** พับเป็นค่าเริ่ม · เครื่อง → สัญญาณ → ตั้งค่า · โฟกัส 570F0F |
| ฟังก์ชัน | ห้ามตัด void / force-close / เครื่อง / ops / แคป / ตั้งค่า |

## ตรวจ

```bash
node scripts/test-npos-manage-slim.mjs
node scripts/test-alerts-pos-manage-hub.mjs
```
