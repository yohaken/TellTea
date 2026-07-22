# nPos — เศษงาน (สcope เรียบ · หน้าร้านขาเร็ว)

อัปเดต: **1.14.16** ตัดช่องทางเคาน์เตอร์ → หลังร้าน/เว็บ BO  
ดู [npos-shop-work-checklist.md](./npos-shop-work-checklist.md) · [npos-blind-shift-close-checklist.md](./npos-blind-shift-close-checklist.md) · [npos-option-qty-parity-checklist.md](./npos-option-qty-parity-checklist.md) · [npos-bestseller-rank-checklist.md](./npos-bestseller-rank-checklist.md) · [npos-sell-flow-polish-checklist.md](./npos-sell-flow-polish-checklist.md) · [npos-receipt-parity-checklist.md](./npos-receipt-parity-checklist.md) · [npos-z-report-form-checklist.md](./npos-z-report-form-checklist.md) · [npos-bo-shift-readonly-checklist.md](./npos-bo-shift-readonly-checklist.md) · [npos-cut-bo-entry-checklist.md](./npos-cut-bo-entry-checklist.md)

## ทำแล้ว
- [x] แคปจอ media-proxy — รูปจริงใน BO (**1.14.2**)
- [x] จอลูกค้าสองพาเนล + 4 โหมด
- [x] โคลนผังขาย + local-first เมนู/รูป
- [x] **W1–W5** เช็คงาน · option · layout 65/35 · outbox · void เซิร์ฟเวอร์ (`nposVoidSale`)
- [x] **C1–C4** ล้างรูป · แสดงเต็มละเอียด · เก็บ ≤50 · POS แคปเต็มละเอียด
- [x] **D1** ตรวจเครื่องพับตาม stableKey · heartbeat ตอนขาย · ออนไลน์ 5 นาที
- [x] **L1** อุ่นแคชเมนูตอนเปิดแอป · ขาย paint จากเครื่องก่อน
- [x] **P1–P8** แคปจอลูกค้าจริง · สไลด์ 5 วิ · แถบซ้าย PosShell · option hero · popup อัปเดตซ้ายบน + กลับขายอัตโนมัติ (**1.14.7**)
- [x] **Smart UI** `UiScale` · กริดเลื่อนลง · FIT_CENTER · ปุ่มจ่ายใหญ่ · เวอร์ชันมุมขวาบน · เข้างานทัชสั้น (**1.14.8**)
- [x] **qty-per-option** ชิปหวาน · steppers multi · เฟรมใกล้เว็บ (**1.14.9**)
- [x] **B1–B4** ปิดกะ blind · Over/Short · เงินทอนรอบถัดไป · Z พิมพ์+ซิงก์ (**1.14.10**)
- [x] **R0–R4** จัดลำดับขายดี · โหมด fix / bestsellers · ตาราง `posMenuRank` (**1.14.11**)
- [x] **F0–F4** ไหลขาย · ตัดทานที่ร้าน · ล้างตะกร้า · PromptPay เว็บ (**1.14.12**)
- [x] **Receipt R1–R4** ฟอร์มใบเสร็จเว็บ → native ESC/POS · พิมพ์ออฟไลน์ได้ (**1.14.13**)
- [x] **Z1–Z3** สลิปปิดกะ หัวร้าน · เปิด/ปิด · ช่องเซ็น · ไม่มี Delivery (**1.14.14**)
- [x] **S1–S3** เว็บกะดูอย่างเดียว · การ์ดรอบหลังบ้าน · เปิดกะยืนยันทอน · ผู้ส่ง/ผู้รับ (**1.14.15**)
- [x] **Cut C1–C4** ตัดช่องทางเคาน์เตอร์ → หลังร้าน/เว็บ BO (**1.14.16**)
- [x] จิ้มเมนู → จ่าย → ใบเสร็จ → รีเซ็ต · ลิ้นชักตอนสด

## คิวถัดไป (เฟสก่อนหน้าที่ยังไม่ทำ)
| เฟส | โฟกัส | สถานะ | ทำไมค้าง |
|-----|--------|--------|----------|
| **Cut C1–C5** | ตัดทางเข้าหลังร้านจากเคาน์เตอร์ | ✅ C1–C4 | **1.14.16** · ค้างคนเทส C5 |
| **S1–S4** | หลังบ้านดูกะ · ไม่ปิดกะจากเว็บ · การ์ดรอบ | ✅ S1–S3 | **1.14.15** · ค้างคนเทส S4 |
| **Z1–Z4** | สลิป Z/X ปิดกะครบพิธีเคาน์เตอร์ | ✅ Z1–Z3 | **1.14.14** · ค้างคนเทส Z4 |
| **Receipt R1–R5** | ใบเสร็จ native = ฟอร์มเว็บ · ESC/POS | ✅ R1–R4 | **1.14.13** · ค้างคนเทส R5 |
| **F0–F5** | ไหลขายพนักงาน · ตัดทานที่ร้าน · ล้างตะกร้า · PromptPay เว็บ | ✅ F0–F4 | **1.14.12** · ค้างคนเทส F5 |
| **R0–R5** | จัดลำดับขายดี · โหมด fix / bestsellers | ✅ R0–R4 | **1.14.11** · ค้างคนเทส R5 |
| **S3 / P4** | คนเทสหน้าร้านจริง | ⬜ | ต้องคนที่เคาน์เตอร์ |
| **P5** | feedback จากนำร่อง | ⬜ | รอ P4 |
| **W6** | สื่อโปรโมจากหลังร้านบนจอ Idle | ⬜ | คู่ขนาน · ยังไม่เริ่ม |
| **Room / SQLite** | Local DB บนเครื่อง (BO = Firebase) | ⬜ | เมื่อคิวโต · L1 แคชพอใช้แล้ว |
| **B1–B4** | ปิดกะ blind (Wongnai-style) | ✅ | **1.14.10** |

## ตัดออกตามนโยบาย
- **N7 ตัดเว็บขาย** — ไม่ทำ (ไม่มีสต๊อกดัน)

## นอกสcope
- ทานที่ร้าน / รับกลับ / Delivery · สลิปครัว / KDS · PromptPay auto cut-off · โน้ตบิล · คูปอง/สมาชิก · บัตร/โอน · ปิดกะจากเว็บ  

## คู่ขนานได้
- [x] **Cut C1–C4** ตัดช่องทางเคาน์เตอร์ → หลังร้าน (**1.14.16**)
- [x] **S1–S3** หลังบ้านดูกะอย่างเดียว + เปิดกะยืนยันทอน (**1.14.15**)
- [x] **Z1–Z3** สลิป Z/X ปิดกะครบพิธี (**1.14.14**)
- [x] **Receipt R1–R4** ฟอร์มใบเสร็จเว็บ → native ESC/POS (**1.14.13**)
- [x] **F0–F4** ไหลขายพนักงาน — ตัดทานที่ร้าน · ล้างตะกร้า · PromptPay เว็บ (**1.14.12**)
- [x] **R1–R4** เก็บขายดี 7→14 วัน · หลังร้านโหมด fix / กลุ่มขายดี · POS auto (**1.14.11**)
- [ ] Local DB first / Room บนเครื่อง เมื่อคิวโต (หลังร้านยัง Firebase)
- [ ] สื่อโปรโมจากหลังร้านบนจอลูกค้า (W6)
- [x] qty-per-option ละเอียดเท่าเว็บ (1.14.9)

```bash
node scripts/check-npos-shop.mjs
# หรือเร็ว: SKIP_CAPTURE_SMOKE=1 node scripts/check-npos-shop.mjs
```
