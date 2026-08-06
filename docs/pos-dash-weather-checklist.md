# POS — อากาศรายวันในตารางยอดขาย

อัปเดต: `APP_BUILD` **721** · `POS_BUILD` **183**

## เป้า
ตาราง **ยอดขายรายวัน** (`/pos-sales` แดชบอร์ด) แสดงสภาพอากาศเมืองอุดรธานีคู่กับยอด เพื่อเทียบผลต่อยอดขาย

## แหล่งข้อมูล
- **วันนี้ (รีเฟรชได้ ไม่เกินทุก 45 นาที):** กรมอุตุฯ Open Data `WeatherToday` สถานี **อุดรธานี** WMO `48354`
- **วันอดีต (เซฟครั้งเดียวแล้วล็อกถาวร):** บันทึกใน `weatherDays` ทันที — เปิดหน้าใหม่**ไม่วิ่ง API** ถ้ามีข้อมูลแล้ว
- ช่วง **กลางวัน / เย็น / ดึก** จากรายชั่วโมงของวันนั้น

## กฎแคช `weatherDays/{YYYY-MM-DD}`
| สถานะ | พฤติกรรม |
|-------|----------|
| `final` | วันอดีต — อ่านอย่างเดียว ไม่ดึงภายนอกซ้ำ |
| `open` | วันนี้เท่านั้น — รีเฟรชเมื่อ `fetchedAt` เก่ากว่า 45 นาที |

Schedule `posWeatherFinalizeDaily` 08:10 Asia/Bangkok ล็อกวันเมื่อวาน

## ไฟล์
- `functions/pos-weather.js` — callable + schedule
- `src/lib/pos-weather.ts` — client
- `PosSalesDashboardCharts` / `PosSalesDashboard` — UI
- `firestore.rules` — owner read, CF write

## ตรวจ
```bash
node scripts/test-pos-dash-weather.mjs
```
