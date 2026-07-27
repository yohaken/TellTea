# nPos — Friendly UI type + buttons

อัปเดต: **1.14.33** · ฟอนต์ Prompt + ปุ่ม/ตัวอักษรเป็นมิตรตาม mockup

## สิ่งที่เปลี่ยน
| # | หัวข้อ | รายละเอียด |
|---|--------|------------|
| 1 | ฟอนต์ | Prompt (Regular/Medium/SemiBold/Bold) · `res/font` + `assets/fonts` · `NposFonts` |
| 2 | ธีม | `Theme.Npos` — พื้น `#F7F7F5` · ส้ม TellTea · ตัวอักษรลำดับชั้น |
| 3 | ปุ่ม | Primary 52dp · Secondary/Ghost 40–44dp · Chip แถวปริ้น · ไม่ยืด Material หนา |
| 4 | Settings | แบนเนอร์พีช · ชิปปริ้น/จอลูกค้า · การ์ด LAN · ปุ่มกลางจอ max ~340dp |
| 5 | เข้างาน/ขาย | ปุ่มสั้นลง · CTA เด่น · `UiScale` ลดความสูงทัช |
| 6 | ตัวอักษร | แบรนด์/หัวข้อ SemiBold–Bold · เนื้อหา Regular · line-height นุ่ม |

## ตรวจ
```bash
node scripts/test-npos-friendly-ui.mjs
node scripts/test-npos-smart-ui-scale.mjs
```
