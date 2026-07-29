# nPos — แคปจอจริง (MediaProjection) + สิทธิ์แคปแยก

อัปเดต: **1.14.83** · `versionCode` 106 · `APP_BUILD` 418 · `POS_BUILD` 135

## ปัญหาเดิม
- BO เห็นจอเขียว เพราะ `statusShot` สีแบรนด์ถูกอัปเป็น `ok=true`
- PixelCopy ใช้ได้แค่หน้าต่างแอปที่ foreground — พอแอปหลับ/ไม่มี Activity → แคปไม่ติด
- พนักงานกดไม่รับสิทธิ์แล้วเงียบ — หลังร้านแคปไม่ได้

## แก้รอบนี้

| หัวข้อ | ทำอย่างไร |
|--------|----------|
| แคปจริง | `MediaProjection` + FGS `mediaProjection` + VirtualDisplay 1 เฟรม |
| ไม่หลอก BO | ไม่ส่ง JPEG ปลอมเขียวเป็นสำเร็จ · ปฏิเสธเฟรมเขียวเกือบทั้งจอ |
| สิทธิ์แคป | แยกจาก BT/แจ้งเตือน — dialog «แชร์หน้าจอ» ของระบบ |
| **เด้งจนกว่าจะรับ** | **1.14.83** — สั่งแคปจาก BO / หลังอัปเดต → ถ้าไม่รับ จะเด้งซ้ำทุก ~2.5 วิ (ไม่ซ้อน dialog) จนกว่าจะกดอนุญาต |
| หลังอัปเดต | ถามเมื่อเปิดแอป · ถ้าไม่รับ → sticky nag จนรับ |
| interval | หลัง deny ถ่วง 6 ชม. (ไม่รบกวนขายทุก heartbeat) — คนละเรื่องกับคำสั่งแคปมือจาก BO |

## ไฟล์หลัก
- `CaptureConsentActivity` · `CaptureProjectionService` · `CaptureProjectionPrefs` · `CapturePrefs`
- `ScreenCapture` · `InstallResultReceiver` · `MainActivity` · `SellActivity`

## คนเทสเคาน์เตอร์
1. อัปเป็น **1.14.83** → เด้งขอแชร์หน้าจอ → กดอนุญาต
2. หลังร้านสั่งแคป → เห็นจอขายจริง (ไม่ใช่เขียวเปล่า)
3. ปฏิเสธครั้งหนึ่ง → **เด้งอีกภายใน ~2–3 วินาที** จนกว่าจะกดอนุญาต
4. แจ้งเตือนค้าง «nPos · แคปจอหลังร้าน» = สิทธิ์ยัง live

```bash
node scripts/test-npos-capture-projection.mjs
```
