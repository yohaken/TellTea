# nPos — ผังขายโคลนเว็บ + local-first sync

อัปเดต: **1.14.3** · `APP_BUILD` 233

## เป้า
- หน้าขายดูใกล้เว็บ: หมวดซ้าย · กริดรูป 5 คอลัมน์ · ตะกร้าขวา · ปุ่มส้ม
- เปิดจอขายเร็วจากแคชเครื่อง · ซิงก์เมนู/รูปพื้นหลังไม่สะดุด

## เช็คลิสต์

### Layout (โคลน PosSellView)
- [x] หมวดอยู่ในคอลัมน์ซ้าย (ไม่เต็มความกว้างจอ)
- [x] เมนูเป็นกริด 5 คอลัมน์ · รูป 16:10 · ป้ายจำนวนส้ม
- [x] ซ้าย weight 65 / ขวา weight 35 (แทน 344dp คงที่)
- [x] ปุ่มชำระเงินสดส้ม · PromptPay รอง
- [x] ชิปหมวด active `#1E2D3D`
- [x] โชว์ option ใต้บรรทัดตะกร้า (W2)

### Local-first + sync เบื้องหลัง
- [x] `MenuRepository.loadMenu` ส่งแคช prefs ทันที แล้วซิงก์ CF
- [x] ถ้า snapshot เหมือนเดิม ไม่รีเฟรช UI ซ้ำ
- [x] `ImageLoader` เก็บรูปใน `cacheDir/menu_img` + LRU
- [x] prefetch รูปหลังโหลดเมนู
- [x] ปุ่มรีเฟรช = force sync · เปิดหน้า = cache-first

### ตรวจ
```bash
node scripts/test-npos-sell-layout.mjs
cd npos-telltea && ./gradlew assembleDebug
```

### มือ
| # | ผ่านเมื่อ |
|---|-----------|
| 1 | เปิดขายเห็นเมนูจากแคชเร็ว (แม้เน็ตช้า) |
| 2 | กริดรูป + หมวดซ้าย + ตะกร้าขวา |
| 3 | หลังเน็ตมา เมนูอัปเดตเงียบๆ |
| 4 | ปิดแอปเปิดใหม่ · รูปยังมาจากดิสก์ |

เศษงานถัดไป: D2–D4 จอลูกค้า · P4 นำร่อง — ดู [npos-remaining-checklist.md](./npos-remaining-checklist.md)
