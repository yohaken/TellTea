# nPos — แคปจอหลังร้าน (รูปจริงในมุมมองผู้ใช้)

เป้า: สั่งแคปจอแล้ว **เห็นรูปจริง** ในหลังร้าน — ไม่ใช่ช่องว่างที่มีแต่ URL

อัปเดต: **1.14.2** · `APP_BUILD` 232

## ตรวจสด (2026-07-22)
ยิง JPEG ทดสอบขึ้น `reportNposScreenCapture` → ได้ URL แบบ Firebase token  
เปิดในเบราว์เซอร์ได้ **HTTP 412** (JSON error เรื่อง Storage service account)  
→ ผู้ใช้เห็นเหมือนมีรูป แต่ภาพว่าง

**แก้:** `nposCaptureMedia` proxy (Admin อ่าน GCS แล้ว stream เป็น `image/jpeg`)  
BO ใช้ `resolveNposCaptureDisplayUrl(shotId)` เสมอ

ตรวจอัตโนมัติหลัง deploy:
```bash
node scripts/smoke-npos-capture-image.mjs
```
ผ่านเมื่อ: URL เป็น media-proxy · HTTP 200 · JPEG magic · variance ไม่ใช่ภาพว่าง

## เช็คลิสต์โค้ด
- [x] อัปโหลด GCS ผ่าน `resolveStorageBucket`
- [x] เก็บ path ใน `nposScreenShots`
- [x] **URL ที่ BO ใช้ = `nposCaptureMedia?id=&role=`**
- [x] แผงเครื่อง / ตรวจเครื่อง / ไทม์ไลน์แคป ใช้ proxy จาก `latestCaptureId` / shot id
- [x] thumb `onError` → «โหลดรูปไม่สำเร็จ»

## มือหลัง deploy
| # | ผ่านเมื่อ |
|---|-----------|
| 1 | `smoke-npos-capture-image` OK |
| 2 | หลังร้านสั่งแคป → เห็นจอแอปจริง (ปุ่ม/เมนู) ไม่ใช่พื้นว่าง |
| 3 | แตะซูมได้ |
