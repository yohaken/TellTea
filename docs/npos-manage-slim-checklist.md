# nPos — BO manage tab super slim

อัปเดต: **1.14.52** · `APP_BUILD` 310 · `POS_BUILD` 105 · vc **75**

## มติ

| ข้อ | ทำ |
|-----|-----|
| แท็บจัดการ `/pos-sales/?tab=manage` | ภาษ visual เดียวกับตารางรอบ (hairline · text btn) |
| ตารางเครื่อง | `npos-slim-row` · แอ็กชันเป็นข้อความ |
| รอบเปิด | หนึ่งบรรทัด ไม่ใช่การ์ดส้ม |
| ชีพจร / รหัสร้าน | ชิปข้อความ · ไม่เปลี่ยน logic เคลม/เตะ/แคป |
| Native เคาน์เตอร์ (กริดเมนูซ้ายบน) | **ยังไม่ทำ** — รอยืนยันขอบเขตแยก |

## ตรวจ

```bash
node scripts/test-npos-manage-slim.mjs
```
