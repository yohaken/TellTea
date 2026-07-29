# nPos — แคปจอจริง (MediaProjection) + สิทธิ์แคปแยก

อัปเดต: **1.14.75** · `versionCode` 98 · `APP_BUILD` 391 · `POS_BUILD` 127

## ปัญหาเดิม
- BO เห็นจอเขียว เพราะ `statusShot` สีแบรนด์ถูกอัปเป็น `ok=true`
- PixelCopy ใช้ได้แค่หน้าต่างแอปที่ foreground — พอแอปหลับ/ไม่มี Activity → แคปไม่ติด

## แก้รอบนี้

| หัวข้อ | ทำอย่างไร |
|--------|----------|
| แคปจริง | `MediaProjection` + FGS `mediaProjection` + VirtualDisplay 1 เฟรม |
| ไม่หลอก BO | ไม่ส่ง JPEG ปลอมเขียวเป็นสำเร็จ · ปฏิเสธเฟรมเขียวเกือบทั้งจอ |
| สิทธิ์แคป | แยกจาก BT/แจ้งเตือน — dialog «แชร์หน้าจอ» ของระบบ |
| ถามครั้งเดียว | หลังอัปเดตถาม 1 ครั้ง · ถ้ารับแล้วเก็บ FGS จน process ตาย |
| ถามใหม่เมื่อจำเป็น | process ตาย / ระบบถอนสิทธิ์ / สั่งแคปจาก BO หลังเคยปฏิเสธ |
| ไม่เพลอ | interval หลัง deny ถ่วง 6 ชม. · ไม่เด้งทุก heartbeat |

## ไฟล์หลัก
- `CaptureConsentActivity` · `CaptureProjectionService` · `CaptureProjectionPrefs`
- `ScreenCapture` · `InstallResultReceiver` · `MainActivity`

## คนเทสเคาน์เตอร์
1. อัปเป็น 1.14.75 → เด้งขอแชร์หน้าจอ → กดอนุญาต
2. หลังร้านสั่งแคป → เห็นจอขายจริง (ไมใช่เขียวเปล่า)
3. ปฏิเสธครั้งหนึ่ง → สั่งแคปมืออีกครั้งค่อยถามใหม่ (ไม่รัว)
4. แจ้งเตือนค้าง «nPos · แคปจอหลังร้าน» = สิทธิ์ยัง live
