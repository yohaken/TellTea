# nPos — D1 สเปกจอ + C1 แคปจอหลังร้าน

เป้า: สั่งแคปแล้ว **มีรูปจริง** ในหลังร้าน · ดูบนมือถือได้ทันที

อัปเดต: **1.12.2** · `APP_BUILD` 227

## สาเหตุที่เคยล้ม (ops: แคปจอไม่สำเร็จ)
CF อัปโหลดไป bucket `mypeer-501909.firebasestorage.app` ที่**ไม่มีจริง** → HTTP 500 `bucket does not exist`

## เช็คลิสต์

### อัปโหลด / CF
- [x] `resolveStorageBucket` ลอง appspot + firebasestorage.app
- [x] deploy เขียน env จาก bucket ที่ ensure เจอจริง
- [x] token download URL (มือถือเปิดได้)

### นาทีฟ
- [x] ack คำสั่งหลังอัปโหลดสำเร็จเท่านั้น
- [x] PixelCopy + fallback วาดจอ / ภาพสถานะ
- [x] ไม่เคลียร์ foreground activity ตอน pause สั้นๆ

### หลังร้านดูรูป
- [x] แผง **เครื่อง nPos** — รูปใต้การ์ดเครื่อง · แตะซูม
- [x] แผง **ตรวจเครื่อง** — เหมือนกัน (`NposCaptureGallery` + `ImagePreviewModal`)

### มือหลัง deploy
| # | ขั้นตอน | ผ่านเมื่อ |
|---|---------|-----------|
| 1 | อัปเดต APK 1.12.2 | เวอร์ชันตรง |
| 2 | เปิดแอปค้างไว้ | ออนไลน์ |
| 3 | หลังร้าน → สั่งแคปจอ | ไม่ขึ้นสิทธิ์ไม่พอ |
| 4 | รอ ≤1 นาที · รีเฟรชแผงเครื่อง | เห็นรูป · แตะดูเต็มจอได้ |
| 5 | ไทม์ไลน์ | «ส่งแคปจอแล้ว» |

ดูเศษงานเฟสถัดไป: [npos-remaining-checklist.md](./npos-remaining-checklist.md)
