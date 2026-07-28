# nPos — เช็คสเปค / อุปกรณ์หน้างาน (live)

อัปเดต: ตามสคริปต์ `scripts/check-npos-devices-live.mjs`

## ชุดมาตรฐาน 1 เคาน์เตอร์

| ชิ้น | หมายเหตุ |
|------|----------|
| แท็บเล็ต Android | แอป `nPos-telltea` |
| ปริ้นเตอร์ ESC/POS | USB / BT / LAN · กระดาษ 80 หรือ 58 |
| ลิ้นชักเงิน | พ่วงพอร์ตปริ้นเตอร์ · เด้งเฉพาะเงินสด |
| จอลูกค้า (ถ้ามี) | จอ 2 / HDMI |

ไม่มีในสcope ร้านชงชาหน้าบาร์: ปริ้นเตอร์ครัว · สแกนเนอร์

## ดึงสถานะเครื่องจริง

หลังร้าน: https://telltea-shop.web.app/pos-sales/?tab=manage

หรือรัน Admin dump:

```bash
FIREBASE_SERVICE_ACCOUNT='{...}' npm run check:npos-devices
```

GitHub Actions: workflow **Check nPos on-site devices** (`workflow_dispatch` หรือ push ไฟล์สคริปต์เข้า `main`)  
→ artifact `npos-onsite-devices` (`summary.md` + `report.json`)

รายงานรวม: รุ่นย่อย client (`1.14.66 (89)`) · ออนไลน์ · พร้อมพิมพ์/ลิ้นชัก/จอลูกค้า · จอ px/dpi · USB/BT จาก diagnose
