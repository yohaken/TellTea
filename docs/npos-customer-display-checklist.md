# nPos — จอลูกค้าสองพาเนล + auto-resize

อัปเดต: **1.14.1** · `APP_BUILD` 231

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
โจทย์: emu แนวตั้ง · ร้านแนวตั้ง/นอนยังไม่ล็อกสเปค  

`CustomerDisplayMetrics.from(secondaryDisplay)`:
- อ่าน **ขนาดจอลูกค้าจริง** (ไม่ยึดจอพนักงาน)
- `landscape` → แยกซ้าย/ขวา · `portrait` → ซ้อนบน/ล่าง
- `scale` จาก short-edge / 720 (clamp 0.72–1.55) → ตัวอักษร / padding / QR
- QR ขนาด ~55–62% ของด้านสั้นของพาเนล media (160–520px)

เมื่อได้สเปคจอร้านจริง: ปรับแค่ค่าใน `CustomerDisplayMetrics` ไม่ต้องรื้อ layout

## สื่อโปรโม
ตอนนี้ = เมนูแนะนำ (+รูป) หมุนทุก **5 วิ** · ยังไม่มี CMS วิดีโอ/แบนเนอร์จาก BO

## ตรวจ
```bash
node scripts/test-npos-customer-display.mjs
cd npos-telltea && ./gradlew assembleDebug
```
