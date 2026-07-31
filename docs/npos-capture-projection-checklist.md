# nPos — แคปจอจริง (MediaProjection) + สิทธิ์แคปแยก

อัปเดต: **1.14.96** · `versionCode` 119 · `APP_BUILD` 530 · `POS_BUILD` 147

## ปัญหาเดิม
- BO เห็นจอเขียว เพราะ `statusShot` สีแบรนด์ถูกอัปเป็น `ok=true`
- PixelCopy ใช้ได้แค่หน้าต่างแอปที่ foreground — พอแอปหลับ/ไม่มี Activity → แคปไม่ติด
- พนักงานกดไม่รับสิทธิ์แล้วเงียบ — หลังร้านแคปไม่ได้
- **รายงานว่างแล้วยัง ack** → คำสั่ง「สั่งแคปจอ」หาย · ไม่ retry
- เฟรมดำแรกของ VirtualDisplay ถูก reject แล้วไม่ fallback
- BO สร้าง proxy URL จาก `shotId` อย่างเดียว → thumb 404 แม้ไม่มีรูปใน role นั้น

## แก้รอบนี้

| หัวข้อ | ทำอย่างไร |
|--------|----------|
| แคปจริง | `MediaProjection` + FGS `mediaProjection` + VirtualDisplay 1 เฟรม |
| ข้ามเฟรมดำ | poll VirtualDisplay จนได้เฟรมที่ไม่ดำ/ว่าง · reject เขียว/ดำ → ลอง PixelCopy ต่อ |
| ไม่หลอก BO | ไม่ส่ง JPEG ปลอมเขียวเป็นสำเร็จ · ไม่ invent proxy URL เมื่อไม่มีรูป |
| Ack เมื่อมีรูป | `lastCaptureAckAt` / local ack **เฉพาะเมื่อ `hasImages`** — ว่างแล้ว heartbeat ลองใหม่ |
| ไม่ลบรูปเก่า | รายงานว่างไม่ wipe `latestPrimaryUrl` |
| สิทธิ์แคป | แยกจาก BT/แจ้งเตือน — dialog «แชร์หน้าจอ» ของระบบ |
| หลังอนุญาต | รอ projection live สูงสุด ~3 วิ ก่อนแคป (กัน race เปิด dialog ซ้ำ) |
| **เด้งจนกว่าจะรับ** | สั่งแคปจาก BO / หลังอัปเดต → ถ้าไม่รับ จะเด้งซ้ำทุก ~2.5 วิ จนกว่าจะกดอนุญาต |
| interval | หลัง deny ถ่วง 6 ชม. — คนละเรื่องกับคำสั่งแคปมือจาก BO |

## ไฟล์หลัก
- `CaptureConsentActivity` · `CaptureProjectionService` · `CaptureProjectionPrefs` · `CapturePrefs`
- `ScreenCapture` · `functions/npos-capture.js` · `src/lib/npos-capture-media.ts`
- `InstallResultReceiver` · `MainActivity` · `SellActivity`

## คนเทสเคาน์เตอร์
1. อัปเป็น **1.14.96** → เด้งขอแชร์หน้าจอ → กดอนุญาต
2. หลังร้านสั่งแคป → เห็นจอขายจริง (ไม่ใช่เขียวเปล่า / ไม่ 404)
3. ปฏิเสธครั้งหนึ่ง → **เด้งอีกภายใน ~2–3 วินาที** จนกว่าจะกดอนุญาต
4. แจ้งเตือนค้าง «nPos · แคปจอหลังร้าน» = สิทธิ์ยัง live
5. ถ้าครั้งแรกไม่มีรูป → สถานะยัง「รอแคป…」แล้วได้รูปใน heartbeat ถัดไป

```bash
node scripts/test-npos-capture-projection.mjs
node scripts/test-npos-capture.mjs
```
