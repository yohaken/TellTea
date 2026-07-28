# nPos — SUNMI InnerPrinter (built-in)

อัปเดต: **1.14.67** · vc **90**

## ปัญหาหน้างาน
Wongnai พิมพ์/ลิ้นชักบน **SUNMI D2s_PLUS** ได้ · nPos เดิมคุยแค่ USB/BT/LAN ESC/POS → InnerPrinter ไม่ติด  
สิทธิ์แอปไม่เกี่ยว — ต้องผูกบริการ `woyou.aidlservice.jiuiv5` (AIDL) เหมือนแอป POS บน SUNMI

## ทำแล้ว
| ข้อ | รายละเอียด |
|-----|------------|
| SDK | `com.sunmi:printerlibrary:1.0.24` |
| Endpoint | `SUNMI · SUNMI InnerPrinter` โผล่ตอนสแกนบนเครื่อง Sunmi |
| พิมพ์ | `sendRAWData` (ESC/POS เดิมของเรา) |
| ลิ้นชัก | `openDrawer` (ไม่ยิง ESC p ผ่าน BT ปลอม) |
| Manifest | `<queries>` แพ็กเกจบริการปริ้น |

## พนักงานหลังอัปเดต 1.14.67
1. ตั้งค่า → อัปเดตเลย
2. อุปกรณ์ → สแกน → เลือก **SUNMI InnerPrinter**
3. พิมพ์ทดสอบ → เปิดลิ้นชักทดสอบ
4. ขายทดลอง 1 บิลสด

```bash
node scripts/test-npos-sunmi-inner-printer.mjs
```
