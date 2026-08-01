# nPos — มีอะไรใหม่หลังอัปเดต

อัปเดต: **1.14.107** · vc **130**

## พฤติกรรม
- โชว์ **ครั้งเดียวต่อ `versionCode`** เมื่อมีสไลด์ใน `WhatsNewCatalog`
- การ์ดกลางจอเล็ก · ปัดซ้าย–ขวา · จุดหน้า · ปุ่ม **ถัดไป / เข้าใจแล้ว** + **ปิด**
- แตะพื้นหลังมืด = ปิด · จำ ack แล้วไม่เด้งซ้ำในเวอร์ชันนี้
- มีรูปในสไลด์ได้ (drawable) · ไม่มีรูป = ข้อความอย่างเดียว ไม่เว้นช่องใหญ่
- **ไม่ทับ** forced update popup (`updatePopup` เปิดอยู่ → ข้าม)
- ใช้ `NposUi` / Prompt — ห้าม `AlertDialog.setItems`

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
