# POS — อากาศรายวันในตารางยอดขาย

อัปเดต: `APP_BUILD` **719** · `POS_BUILD` **182**

## เป้า
ตาราง **ยอดขายรายวัน** (`/pos-sales` แดชบอร์ด) แสดงสภาพอากาศเมืองอุดรธานีคู่กับยอด เพื่อเทียบผลต่อยอดขาย

## แหล่งข้อมูล
- **วันนี้ (รีเฟรชได้):** กรมอุตุฯ Open Data `WeatherToday` สถานี **อุดรธานี** WMO `48354`
- **วันอดีต (แบ็กฟิลครั้งเดียวแล้วล็อก):** ข้อมูลอุตุฯที่พิกัดสถานีอุดรฯ ผ่าน Open-Meteo history — เพราะ TMD WeatherToday ไม่รับ `date=` ย้อนหลัง
- ช่วง **กลางวัน / เย็น / ดึก** จากรายชั่วโมงของวันนั้น

## กฎแคช `weatherDays/{YYYY-MM-DD}`
| สถานะ | พฤติกรรม |
|-------|----------|
| `final` | วันอดีตที่ปิดแล้ว — **ไม่อัปเดตซ้ำ** |
| `open` | วันนี้ — เรียก `ensurePosWeatherDays` แล้วรีเฟรชได้ |

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
