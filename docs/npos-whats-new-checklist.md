# nPos — มีอะไรใหม่หลังอัปเดต

อัปเดต: **135** · vc **135** (ชื่อสั้น = versionCode · OTA ใช้เฉพาะเลขโค้ด)

## กฎโครงสร้าง (บังคับทุก ship)

ทุกครั้งที่ bump `versionCode` ใน `npos-telltea/app/build.gradle` **ต้อง** เพิ่มสไลด์ใน `WhatsNewCatalog.slidesFor` สำหรับโค้ดนั้น — ไม่ว่าง

- CI: `node scripts/test-npos-whats-new.mjs` อ่าน `versionCode` ปัจจุบัน แล้ว fail ถ้าไม่มี `WhatsNewSlide`
- พนักงานเห็นการ์ดครั้งเดียวต่อ `versionCode` → กด **ถัดไป** ทีละหน้า → **เข้าใจแล้ว**
- Checklist นี้ต้องอัปเดตเลขเวอร์ชันให้ตรง APK ด้วย

## ชื่อเวอร์ชันสั้น + OTA (ห้ามพลาด)

- `versionName` = ตัวเลขเดียวกับ `versionCode` (เช่น `"135"`) — สั้น อ่านง่ายบนเครื่อง
- **แท็บเล็ตอัปเดตเมื่อ `latest.json.versionCode` > โค้ดในเครื่องเท่านั้น** — เปลี่ยนรูปแบบชื่อไม่มีผลบล็อก/ปลดบล็อก
- อย่าลด `versionCode` · ทุก ship ต้องสูงกว่าของบน `telltea-pos` ตอนนั้น (live ตอนนี้ 134 → ship 135+)
- `versionName` ต้องไม่ว่าง (manifest parse บังคับ) แต่ไม่ใช้เทียบเวอร์ชัน

## พฤติกรรม
- โชว์ **ครั้งเดียวต่อ `versionCode`** เมื่อมีสไลด์ใน `WhatsNewCatalog`
- การ์ดกลางจอเล็ก · ปัดซ้าย–ขวา · จุดหน้า · ปุ่ม **ถัดไป / เข้าใจแล้ว** + **ปิด**
- แตะพื้นหลังมืด = ปิด · จำ ack แล้วไม่เด้งซ้ำในเวอร์ชันนี้
- มีรูปในสไลด์ได้ (drawable) · ไม่มีรูป = ข้อความอย่างเดียว ไม่เว้นช่องใหญ่
- **ไม่ทับ** forced update popup (`updatePopup` เปิดอยู่ → ข้าม)
- ใช้ `NposUi` / Prompt — ห้าม `AlertDialog.setItems`

## สไลด์ vc 135
1. ลงชื่อผู้เริ่มรอบหลังปิดกะ
2. แก้ไขยอดนับสต็อกได้
3. เมนูขายสั้นลง
4. เงินทอนเริ่มรอบคีย์ใหม่ได้

## ไฟล์
| ไฟล์ | หน้าที่ |
|------|--------|
| `update/WhatsNewCatalog.java` | สไลด์ต่อ versionCode |
| `update/WhatsNewPrefs.java` | ack ใน SharedPreferences |
| `update/WhatsNewController.java` | overlay ปัดได้ + ปิด |
| `SellActivity` / `MainActivity` | `maybeShow` หลัง resume |

## ตรวจ
```bash
node scripts/test-npos-whats-new.mjs
node scripts/test-npos-friendly-ui.mjs
```
