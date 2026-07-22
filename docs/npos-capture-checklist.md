# nPos — D1 สเปกจอ + C1 แคปจอหลังร้าน

เป้า: สั่งแคปแล้ว **มีรูปจริง** ในหลังร้าน · ดูบนมือถือได้ทันที

อัปเดต: **1.13.1** · `APP_BUILD` 229

## สาเหตุที่เคยล้ม
1. CF อัปโหลดไป bucket `*.firebasestorage.app` ที่ไม่มีจริง → HTTP 500
2. **URL token ใน Firestore ดูมีรูป แต่ `<img>` โหลดไม่ได้** (UBLA / token ไม่ผูก) → ใช้ signed URL แบบ evidence
3. แผงเครื่องอ่าน URL แค่จาก `nposDiagnose` + `orderBy(reportedAt)` → เอกสารแคปอย่างเดียวหายจาก query

## เช็คลิสต์

### อัปโหลด / CF
- [x] `resolveStorageBucket` ลอง appspot + firebasestorage.app
- [x] deploy เขียน env จาก bucket ที่ ensure เจอจริง
- [x] **signed read URL** (fallback token) ใน `reportNposScreenCapture`
- [x] เขียน URL ลงทั้ง `nposDiagnose` + `posDevices` + `nposScreenShots`

### นาทีฟ
- [x] ack คำสั่งหลังอัปโหลดสำเร็จเท่านั้น
- [x] PixelCopy + fallback วาดจอ / ภาพสถานะ
- [x] อ่าน `hasImages` จาก CF → ops «ส่งแคปจอแล้ว» หรือ warn «ไม่มีรูปบนเซิร์ฟเวอร์»

### หลังร้านดูรูป / ไทม์ไลน์
- [x] แผง **เครื่อง nPos** — diagnose URL หรือ fallback `posDevices.latest*Url`
- [x] แผง **ตรวจเครื่อง** — `orderBy(updatedAt)` รวมเอกสารแคป
- [x] **ไทม์ไลน์แคปจอ** (`nposScreenShots`) + รูปย่อ
- [x] ไทม์ไลน์ ops แสดง **รายละเอียด** ใต้ข้อความ
- [x] thumb `onError` → «โหลดรูปไม่สำเร็จ» (ไม่เงียบ)

### มือหลัง deploy
| # | ขั้นตอน | ผ่านเมื่อ |
|---|---------|-----------|
| 1 | อัปเดต APK 1.13.1 (หรือรอ CF/web ก่อนก็ได้ — URL ใหม่จากเซิร์ฟเวอร์) | เวอร์ชันตรง |
| 2 | เปิดแอปค้างไว้ | ออนไลน์ |
| 3 | หลังร้าน → สั่งแคปจอ | ไม่ขึ้นสิทธิ์ไม่พอ |
| 4 | รอ ≤1 นาที · แผงเครื่อง + ไทม์ไลน์แคป | **เห็นรูปจริง** · แตะซูมได้ |
| 5 | ไทม์ไลน์ ops | «ส่งแคปจอแล้ว» + รายละเอียด `shot=` / `url=yes` |

ดูเศษงานเฟสถัดไป: [npos-remaining-checklist.md](./npos-remaining-checklist.md)
