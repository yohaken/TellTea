# nPos — จอลูกค้าสองพาเนล + auto-resize

อัปเดต: **1.14.73** · vc **96** · `APP_BUILD` 365  
(ตัวอักษรใหญ่ขึ้นบน 10.1" — ดู `npos-customer-type-scale-checklist.md`)

## แผน layout (ใช้แล้ว)
| พื้นที่ | สัดส่วน | เนื้อหา |
|--------|---------|---------|
| **หลัก (media)** | landscape 65% (ultra-wide 70%) · portrait บน 58% | สไลด์โปรโม/เมนูแนะนำ · โหมดจ่ายทับด้วย QR/เงินสด |
| **ข้าง (receipt)** | landscape 35% (30%) · portrait ล่าง 42% | Idle = โลโก้/ต้อนรับ · Ordering/Payment = รายการ+Subtotal/ส่วนลด/สุทธิ |

## State
1. **Idle** — media เต็มสไลด์ · ข้างโลโก้/ยินดีต้อนรับ  
2. **Ordering** — media ยังเล่นโปรโม (upsell) · ข้างอัปเดตรายการ realtime  
3. **Payment** — media = QR ใหญ่ + ยอดสุทธิ (หรือรับ/ทอน) · ข้างสรุปรายการ  
4. **Success** — ✓ เขียว · «ชำระเงินสำเร็จ» · เงินทอน (ถ้าสด) · กลับ Idle ~3.5 วิ  

## Auto-resize (ฉลาดข้ามสกเกล)
โจทย์: emu แนวตั้ง · ร้าน D2s จอลูกค้า **10.1" 1024×600**

`CustomerDisplayMetrics.from(secondaryDisplay)`:
- อ่าน **ขนาดจอลูกค้าจริง** (ไม่ยึดจอพนักงาน)
- `landscape` → แยกซ้าย/ขวา · `portrait` → ซ้อนบน/ล่าง
- `scale` จาก short-edge / **600** (clamp 0.95–1.45) → ตัวอักษร / padding / QR
- ฐาน: body 19 · title 24 · total 40 · brand 30 (× scale)
- ฟอนต์ **Prompt** (XML + `NposFonts` รายการไดนามิก)
- QR ขนาด ~55–62% ของด้านสั้นของพาเนล media (180–560px)

## สื่อโปรโม
ตอนนี้ = เมนูแนะนำ (+รูป) หมุนทุก **5 วิ** · ยังไม่มี CMS วิดีโอ/แบนเนอร์จาก BO

## ตรวจ
```bash
node scripts/test-npos-customer-display.mjs
node scripts/test-npos-system-ver-sync.mjs
cd npos-telltea && ./gradlew assembleDebug
```
