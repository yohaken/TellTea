# nPos — BO manage tab super slim

อัปเดต: **1.14.67** · `APP_BUILD` 330 · `POS_BUILD` 119 · vc **90**

## มติ

| ข้อ | ทำ |
|-----|-----|
| แท็บจัดการ | **4 หมวด** พับเป็นค่าเริ่ม · เรียงตามความถี่เปลี่ยน |
| 1 เครื่อง nPos | ออนไลน์ · เวอร์ชัน · seat · อุปกรณ์ (เปลี่ยนบ่อยสุด → บนสุด) |
| 2 สัญญาณ · ตรวจ · แคป | รวม ops + diagnose + แคป ในหมวดเดียว (embed ย่อย) |
| 3 เข้างาน · ชีพจร | รวมรหัสร้าน/seat + ช่วงเช็คเซิร์ฟเวอร์ |
| 4 ร้าน · สลิป | ชื่อ/ที่อยู่/ตัวอย่างบิล (เปลี่ยนน้อย → ล่างสุด · พับ) |
| ตารางเครื่อง | เทคนิค · เวอร์ชันระบบ vs nPos · ✓ เขียวเมื่อตรง |
| ล้างเทส | ปุ่ม **ลบ emulator + บิลทดสอบ** |

## ตรวจ

```bash
node scripts/test-npos-manage-slim.mjs
node scripts/test-npos-bo-table-tech-focus.mjs
node scripts/test-alerts-pos-manage-hub.mjs
```
