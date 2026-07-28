# nPos — BO manage tab super slim

อัปเดต: **1.14.67** · `APP_BUILD` 329 · `POS_BUILD` 119 · vc **90**

## มติ

| ข้อ | ทำ |
|-----|-----|
| แท็บจัดการ `/pos-sales/?tab=manage` | ภาษ visual เดียวกับตารางรอบ (hairline · text btn) |
| ตารางเครื่อง | ตาราง**เทคนิค** · ไม่โชวยอดขาย/รอบ (ไปหน้า รอบการขาย nPos) |
| เวอร์ชัน | คอลัมน์ **เวอร์ชันระบบ** vs **เวอร์ชัน nPos** · ตรงแล้วแสดง **✓ เขียว** |
| อุปกรณ์ | คอลัมน์ พิมพ์ / ลิ้นชัก / จอลูกค้า (`พ✓ ล✓ จ—`) จาก heartbeat |
| โฟกัส | แสดง **หน้าร้าน** เท่านั้น · ซ่อน emulator/dev |
| ล้างเทส | ปุ่ม **ลบ emulator + บิลทดสอบ** ลบเครื่อง/log/รอบ/บิลที่ไม่ใช่เครื่องหน้าร้าน |
| ชีพจร / รหัสร้าน | ชิปข้อความ · ไม่เปลี่ยน logic เคลม/เตะ/แคป |

## ตรวจ

```bash
node scripts/test-npos-manage-slim.mjs
node scripts/test-npos-bo-device-version-equip.mjs
node scripts/test-npos-bo-table-tech-focus.mjs
```
