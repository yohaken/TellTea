# nPos — Option qty-per-option parity (web frame → native)

อัปเดต: **1.14.9** · `APP_BUILD` 239

## ความเข้าใจที่ล็อก
| หัวข้อ | ความหมาย |
|--------|----------|
| **Room / SQLite** | **Local DB บนเครื่อง POS** — เก็บคิว/แคชเมื่อโต · หลังร้านยังเป็น **Firebase** |
| **N7 ตัดเว็บขาย** | **ไม่ทำ** (ไม่มีสต๊อกดัน) |
| **W6** | สื่อโปรโมจาก BO บนจอ Idle — ยังค้างคู่ขนาน |
| **qty-per-option** | ทำแล้วใน 1.14.9 — เฟรมใกล้เว็บ |

## เฟรมเทียบเว็บ (`PosOptionPickerModal`)
| เฟรม | เว็บ | Native 1.14.9 |
|------|------|----------------|
| Hero | รูป + ชื่อ + ราคา + qty −/+ | เหมือน · สีสว่าง · `UiScale` |
| ความหวาน | ชิปแถวเลือก 1 | ชิปแถว wrap · ทัชใหญ่ |
| single | แถว ○/● | แถวทัชเต็ม · ไม่ซ่อน |
| multi / unlimited | − count + ต่อตัวเลือก | steppers · ซ้ำ choice ใน JSON เหมือนเว็บ |
| Footer | ยกเลิก · ตกลง · ฿ | CTA ส้มใหญ่ · จำกัดความสูง body กันเลื่อนเกิน |

## ตรวจ
```bash
node scripts/test-npos-option-qty-parity.mjs
SKIP_CAPTURE_SMOKE=1 node scripts/check-npos-shop.mjs
```
