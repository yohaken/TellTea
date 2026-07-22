# nPos — แคปจอหลังร้าน (รูปจริง · เต็มละเอียด · เก็บ ≤50)

เป้า: สั่งแคปจอแล้ว **เห็นรูปจริงเต็มความละเอียด** ในหลังร้าน — ล้างได้ · ไม่กองเกิน 50/เครื่อง

อัปเดต: **1.14.5** · `APP_BUILD` 235

## เฟสแคปรอบนี้ (C1–C4)

| เฟส | งาน | สถานะ |
|-----|-----|--------|
| **C1** | ปุ่ม «ล้างรูปเคลียร์ทั้งหมด» (ไทม์ไลน์) + «ล้างภาพแคป» ต่อเครื่อง | ✅ |
| **C2** | แสดงรูปแบบเต็มเฟรม (`object-fit: contain`) · แตะซูมเต็มละเอียด | ✅ |
| **C3** | เก็บไม่เกิน **50** รูป/เครื่อง — ลบเก่าส่วนเกินตอนอัปโหลด | ✅ |
| **C4** | POS แคปเต็มละเอียด (ยาวสุด ~1920 · JPEG ~88) | ✅ |

## ตรวจสด (ก่อนหน้า — media proxy)
ยิง JPEG ทดสอบขึ้น `reportNposScreenCapture` → token URL ได้ **HTTP 412**  
**แก้:** `nposCaptureMedia` proxy — BO ใช้ `resolveNposCaptureDisplayUrl(shotId)`

```bash
node scripts/smoke-npos-capture-image.mjs
SKIP_CAPTURE_SMOKE=1 node scripts/check-npos-shop.mjs
```

## เช็คลิสต์โค้ด
- [x] อัปโหลด GCS ผ่าน `resolveStorageBucket`
- [x] เก็บ path ใน `nposScreenShots`
- [x] **URL ที่ BO ใช้ = `nposCaptureMedia?id=&role=`**
- [x] แผงเครื่อง / ตรวจเครื่อง / ไทม์ไลน์แคป ใช้ proxy
- [x] thumb `onError` → «โหลดรูปไม่สำเร็จ»
- [x] `clear_captures` / `clear_captures_all` ผ่าน `nposOwnerDeviceCommand`
- [x] `pruneNposShotsForInstall` หลังอัปโหลด (MAX 50)
- [x] Android `MAX_EDGE=1920` · `JPEG_QUALITY=88`

## มือหลัง deploy
| # | ผ่านเมื่อ |
|---|-----------|
| 1 | `smoke-npos-capture-image` OK |
| 2 | สั่งแคป → เห็นจอแอปจริง อ่านตัวอักษร/ปุ่มได้ชัด (หลังอัป APK 1.14.5) |
| 3 | แตะซูมได้ · รูปไม่ถูกครอปขอบ |
| 4 | กดล้างรูป → ไทม์ไลน์ว่าง |
| 5 | แคปเกิน 50 → เก่าหายอัตโนมัติ |
