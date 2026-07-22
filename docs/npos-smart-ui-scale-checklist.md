# nPos — Smart UI scale (touch-first tablet POS)

อัปเดต: **1.14.8** · `APP_BUILD` 238

## สรุปสิ่งที่เปลี่ยน (รอบนี้)
| # | ปัญหา | แก้ |
|---|--------|-----|
| 1 | กริดเมนูซ้อน / เลื่อนขวาง | คำนวณความกว้างจาก `menuGrid` จริง · weight คอลัมน์ · ScrollView แนวตั้งเท่านั้น |
| 2 | กล่องเมนูใหญ่เกิน · รูปตัดชื่อไม่ชัด | `UiScale` ย่อ media สูงสุดแบบเว็บ · `FIT_CENTER` โชว์จานเต็ม · ชื่อ/ราคาอ่านได้ |
| 3 | ปุ่มคิดเงินเล็ก / ดูเหมือนปุ่มโบราณ | CTA ส้มสูงตามสเกลเว็บ (~64dp+) · drawable มุมโค้ง ไม่ใช้ Material Button หนา |
| 4 | แถบซ้ายฟิกซ์ 176dp | `UiScale.navWidthPx` + ตัวอักษร/ความสูงทัชอัตโนมัติ |
| 5 | หาเวอร์ชันยาก | ป้ายมุมขวาบนบาร์ขาย + ฮับ |
| 6 | ปุ่มเข้างาน/ตั้งค่ายาว | ปุ่มทัชสั้น «เข้างาน» / «ตั้งค่า» · ความสูงตามสเกล |
| 7 | หลังอัปควรเห็น popup | ขึ้น **1.14.8** → เครื่องที่ยัง 1.14.7 จะได้ popup อัปเดต |

## โมดูล
`app.telltea.npos.ui.UiScale` — สเกลจาก short-edge / 720 (แนวเดียวกับ `CustomerDisplayMetrics` / rem เว็บ) ไม่ต้องฟิกซ์ขนาดต่อเครื่อง

```bash
node scripts/test-npos-smart-ui-scale.mjs
SKIP_CAPTURE_SMOKE=1 node scripts/check-npos-shop.mjs
```
