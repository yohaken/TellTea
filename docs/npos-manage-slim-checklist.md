# nPos — BO manage tab super slim

อัปเดต: **1.14.66** · `APP_BUILD` 327 · `POS_BUILD` 119 · vc **89**

## มติ

| ข้อ | ทำ |
|-----|-----|
| แท็บจัดการ `/pos-sales/?tab=manage` | ภาษ visual เดียวกับตารางรอบ (hairline · text btn) |
| ตารางเครื่อง | `npos-slim-row` · แอ็กชันเป็นข้อความ |
| เวอร์ชัน | แสดง **รุ่นย่อย client** เช่น `1.14.66 (89)` — ไม่โชว์แค่เลข build |
| อุปกรณ์ | คอลัมน์ พิมพ์ / ลิ้นชัก / จอลูกค้า (`พ✓ ล✓ จ—`) จาก heartbeat |
| รอบเปิด | หนึ่งบรรทัด ไม่ใช่การ์ดส้ม |
| ชีพจร / รหัสร้าน | ชิปข้อความ · ไม่เปลี่ยน logic เคลม/เตะ/แคป |
| Native เคาน์เตอร์ (กริดเมนูซ้ายบน) | **ยังไม่ทำ** — รอยืนยันขอบเขตแยก |

## ตรวจ

```bash
node scripts/test-npos-manage-slim.mjs
node scripts/test-npos-bo-device-version-equip.mjs
```
