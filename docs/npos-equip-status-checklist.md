# nPos — สถานะพิมพ์ / ลิ้นชักในตาราง BO

อัปเดต: **1.14.70** · vc **93** · `APP_BUILD` 355 · `POS_BUILD` 122

## ปัญหา
ปริ้น/ลิ้นชักใช้ได้ที่เครื่อง แต่คอลัมน์อุปกรณ์โชว์ `พ—`/`พ×` · `ล—`/`ล×`

## สาเหตุ
- พิมพ์สำเร็จจากขายไม่เคย `saveSuccess` → หรือทดสอบล้มแล้ว `markNotReady` ทั้งที่ยังพิมพ์ได้
- Heartbeat ส่ง `printerReady=false` → ตารางไม่ขึ้น ✓

## แก้แล้ว
| ข้อ | รายละเอียด |
|-----|------------|
| `PrinterTransport` | ส่งสำเร็จ → `PrinterPrefs.saveSuccess` เสมอ |
| Settings ทดสอบพิมพ์ | ล้มเหลว **ไม่** เคลียร์ ready ของเครื่องที่เคยใช้ได้ |
| Heartbeat | ส่ง `printerReady` + `drawerReady` · heal Sunmi auto-select |
| Cloud Function | สร้าง doc ใหม่ไม่ทับค่า ready จาก body |

## พนักงานหลังอัป 1.14.70
1. อัปเดตแอป → **1.14.70**
2. ตั้งค่า → **พิมพ์ทดสอบ** หรือขาย 1 บิล (รอ ~5 วิ)
3. หลังร้าน `/pos-sales?tab=manage` → อุปกรณ์ควรเป็น `พ✓ ล✓`

```bash
node scripts/test-npos-equip-status.mjs
```
