# nPos — จอลูกค้าตัวอักษรใหญ่ขึ้น (10.1" scale) + Prompt

อัปเดต: **1.14.73** · vc **96** · `APP_BUILD` 365 · `POS_BUILD` 125

## ปัญหา
พนักงานรายงานจอลูกค้าตัวหนังสือเล็ก — จริงบน D2s 10.1" **1024×600** (short edge 600)
สเกลเดิมอิง 720 → body ~12.5sp (~2.7mm) อ่านยากระยะเคาน์เตอร์

## แก้
| รายการ | เดิม | ใหม่ |
|--------|------|------|
| อ้างอิง short-edge | 720 | **600** (D2s 10.1") |
| floor scale | 0.72 | **0.95** |
| body / title / total / brand | 15 / 20 / 34 / 26 | **19 / 24 / 40 / 30** × scale |
| ฟอนต์ | XML Prompt · รายการไดนามิก default bold | **Prompt** ทั้งต้นไม้ + รายการ semibold/regular · letter-spacing นุ่ม |

บน 1024×600: scale=1 → รายการ ~19sp · ยอด ~40sp

## ไฟล์
- `CustomerDisplayMetrics.java`
- `CustomerDisplayPresentation.java` (`NposFonts`)

## ตรวจ
```bash
node scripts/test-npos-customer-display.mjs
node scripts/test-npos-system-ver-sync.mjs
```
