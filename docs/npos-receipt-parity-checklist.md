# nPos — ใบเสร็จลูกค้าพาริตี้เว็บ → ESC/POS (ฟอร์มเดียวกัน)

อัปเดต: **1.14.13** (ใบเสร็จ) · ship ปัจจุบัน **1.14.18** · `APP_BUILD` 250 · `POS_BUILD` 70 · `versionCode` 41  

เป้าหมาย: พนักงานขายบนแท็บเล็ต nPos ได้ใบเสร็จหน้าตา/ฟิลด์**เหมือนเว็บ** แต่ส่งเครื่องพิมพ์ฮาร์ดแวร์ตรง (USB / BT / LAN) — ไม่ผ่านไดอะล็อกเบราว์เซอร์

อ้างอิงเว็บ: `src/lib/pos-printer/receipt-template.ts` → `buildUnifiedReceiptBody`  
อ้างอิง native: `ReceiptFormBuilder` + `EscPos.documentReceipt`  
ข้อความเทียบ: `src/lib/pos-printer/receipt-text-form.ts` → `buildUnifiedReceiptText`

---

## นโยบายที่ล็อกแล้ว

| หัวข้อ | ตัดสิน |
|--------|--------|
| ใบเสร็จลูกค้า | **ยกฟอร์มเว็บมา native** · หน้าตา/ลำดับฟิลด์ตรงกัน |
| พิมพ์ผ่านฮาร์ดแวร์ | ESC/POS ตรงเครื่อง · ไม่มี OS print dialog |
| ช่องทางทานที่ร้าน/รับกลับ/เดลิเวอรี่ | **ไม่พิมพ์ badge** (front-counter only) |
| ปิดกะ / Z | native มี BlindClose + Z อยู่แล้ว · **ไม่บังคับเปิดเว็บ** |
| เสริม Z ให้ละเอียดเท่าเว็บ | P1 ทีหลัง · ไม่บล็อกใบเสร็จ |

---

## สถานะก่อนงานนี้ (ช่องว่าง)

| | เว็บ | Native เก่า |
|--|------|-------------|
| ฟอร์ม | ครบ (บิล · ร้าน · ที่อยู่ · โทร · ใบเสร็จ · วันเวลา · รายการ+ราคา · ส่วนลด · สุทธิ · ชำระ · ทอน · ฟุตเตอร์) | สั้น (ชื่อร้าน · บิล · ชื่อ×qty · รวม) |
| หัวสลิป | จากเทมเพลต | บังคับ `TellTea` ทับอีกชั้น |
| จังหวะพิมพ์ | หลังขาย (local) | หลังซิงก์สำเร็จเท่านั้น · flush คิวไม่พิมพ์ |
| ออฟไลน์ | ได้กระดาษ | ไม่ได้จนกว่าซิงก์ (แล้วก็ไม่พิมพ์) |

---

## เฟสงาน

### R1 โครงฟอร์ม native = เว็บ
- [x] `ReceiptFormBuilder` — ลำดับฟิลด์ตรง `buildUnifiedReceiptBody`
- [x] `#บิล` กลาง · ชื่อร้าน EN(+TH) · ที่อยู่ · โทร · หัวข้อ **ใบเสร็จ**
- [x] Meta: Staff / วันที่ / เวลา (Order / ID ถ้ามี)
- [x] รายการ: ชื่อฐาน · ราคาบรรทัด · qty เน้นเมื่อ >1 · modifiers เป็น `•` (+ ×n)
- [x] รวม: จำนวน · รวม · ส่วนลด · **ยอดสุทธิ** · ชำระ · เงินสด/ทอน
- [x] ฟุตเตอร์ `receiptFooterNote` + `TellTea POS`
- [x] **ไม่มี** badge ทานที่ร้าน / รับกลับ / เดลิเวอรี่
- [x] `EscPos.documentReceipt` — ไม่บังคับหัว TellTea ทับฟอร์ม
- [x] Z/X ยังใช้ `EscPos.saleReceipt` แบบเดิม (ไม่ผสมฟอร์มใบเสร็จ)

### R2 ข้อมูลร้าน + พิมพ์ซ้ำ
- [x] อ่าน `shopJson`: shopName / shopNameTh / shopAddress / shopPhone / receiptStaffName / receiptFooterNote / autoPrintReceipt
- [x] payload เก็บ subtotal · cashReceived · change · staff · footer
- [x] `rememberReceipt` เก็บฟิลด์ครบสำหรับ reprint
- [x] `reprintReceipt` ใช้ฟอร์มเดียวกัน

### R3 จังหวะพิมพ์ (ไม่เสียกระดาษซ้ำ / ไม่ทิ้งลูกค้า)
- [x] ออนไลน์: พิมพ์หลังซิงก์ด้วย **เลขบิลจริง**
- [x] ซิงก์พลาด/ออฟไลน์: พิมพ์เลขชั่วคราว `#L-xxxxxx` ทันที
- [x] ธง `printed` — ไม่พิมพ์ซ้ำตอน flush คิวภายหลัง
- [x] flush / retry: พิมพ์ครั้งเดียวถ้ายังไม่เคยพิมพ์ (ได้เลขบิลจริง)
- [x] เงินสด: เปิดลิ้นชักหลังพิมพ์สำเร็จ (ของเดิม)

### R4 พาริตี้ข้อความเว็บ ↔ native
- [x] `receipt-text-form.ts` — ข้อความทองคำคู่กับ Java
- [x] สคริปต์เกตตรวจป้าย/คีย์เวิร์ดร่วม
- [x] export จาก `pos-printer/index.ts`

### R5 คนเทสเคาน์เตอร์ (ค้าง)
- [ ] ขายสด 1 บิล · เทียบกระดาษกับตัวอย่างเว็บ (ฟิลด์ครบ)
- [ ] ขาย PromptPay 1 บิล · ไม่มีแถวเงินสด/ทอน
- [ ] ส่วนลด > 0 โผล่บนสลิป
- [ ] option หลายตัว · qty > 1 เน้น ×n
- [ ] ออฟไลน์สั้นๆ → ได้กระดาษเลข L-… · ซิงก์ทีหลังไม่พิมพ์ซ้ำ
- [ ] พิมพ์ซ้ำจากหน้ารายการบิลได้
- [ ] ปิดกะ blind + Z ยังทำงาน (ไม่ regress)

### R6 (P1 ทีหลัง — ไม่ในรอบนี้)
- [ ] เลือกความกว้าง 58/80 จากตั้งค่าเครื่อง
- [ ] เสริม native Z ให้ใกล้เว็บ (หมวด / รายบิล) ถ้าต้องการ
- [ ] bold / double-size ESC/POS บนหัวบิล (ถ้าเครื่องรองรับ)

---

## ไฟล์หลัก

| ไฟล์ | บทบาท |
|------|--------|
| `npos-telltea/.../printer/ReceiptFormBuilder.java` | สร้างข้อความใบเสร็จ |
| `npos-telltea/.../printer/EscPos.java` | `documentReceipt` + `saleReceipt` (Z) |
| `npos-telltea/.../sell/SaleSync.java` | เรียกฟอร์ม · จังหวะพิมพ์ · reprint |
| `src/lib/pos-printer/receipt-template.ts` | ฟอร์ม HTML เว็บ (ต้นทาง) |
| `src/lib/pos-printer/receipt-text-form.ts` | ฟอร์มข้อความเทียบพาริตี้ |
| `scripts/test-npos-receipt-parity.mjs` | เกต |

---

## ตรวจ

```bash
node scripts/test-npos-receipt-parity.mjs
SKIP_CAPTURE_SMOKE=1 node scripts/check-npos-shop.mjs
```

## หมายเหตุปิดกะ
พนักงานบน nPos **ไม่ต้องเปิดเว็บ** เพื่อปิดกะ/ปริ้น Z — ใช้ Blind close ในแอป  
เว็บกะยังใช้ดูประวัติ/รีปริ้นละเอียดบนคอมได้
