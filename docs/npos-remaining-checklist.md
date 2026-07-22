# nPos — เศษงาน (สcope เรียบ · หน้าร้านขาเร็ว)

อัปเดต: **1.14.11** · คิวถัดไปไหลขายพนักงาน (ตัดทานที่ร้าน)  
ดู [npos-shop-work-checklist.md](./npos-shop-work-checklist.md) · [npos-blind-shift-close-checklist.md](./npos-blind-shift-close-checklist.md) · [npos-option-qty-parity-checklist.md](./npos-option-qty-parity-checklist.md) · [npos-bestseller-rank-checklist.md](./npos-bestseller-rank-checklist.md) · [npos-sell-flow-polish-checklist.md](./npos-sell-flow-polish-checklist.md)

## ทำแล้ว
- [x] แคปจอ media-proxy — รูปจริงใน BO (**1.14.2**)
- [x] จอลูกค้าสองพาเนล + 4 โหมด
- [x] โคลนผังขาย + local-first เมนู/รูป
- [x] **W1–W5** เช็คงาน · option · layout 65/35 · outbox · void เซิร์ฟเวอร์
- [x] **C1–C4** ล้างรูป · แสดงเต็มละเอียด · เก็บ ≤50 · POS แคปเต็มละเอียด
- [x] **D1** ตรวจเครื่องพับตาม stableKey · heartbeat ตอนขาย · ออนไลน์ 5 นาที
- [x] **L1** อุ่นแคชเมนูตอนเปิดแอป · ขาย paint จากเครื่องก่อน
- [x] **P1–P8** แคปจอลูกค้าจริง · สไลด์ 5 วิ · แถบซ้าย PosShell · option hero · popup อัปเดตซ้ายบน + กลับขายอัตโนมัติ (**1.14.7**)
- [x] **Smart UI** `UiScale` · กริดเลื่อนลง · FIT_CENTER · ปุ่มจ่ายใหญ่ · เวอร์ชันมุมขวาบน · เข้างานทัชสั้น (**1.14.8**)
- [x] **qty-per-option** ชิปหวาน · steppers multi · เฟรมใกล้เว็บ (**1.14.9**)
- [x] **B1–B4** ปิดกะ blind · Over/Short · เงินทอนรอบถัดไป · Z พิมพ์+ซิงก์ (**1.14.10**)
- [x] **R0–R4** จัดลำดับขายดี · โหมด fix / bestsellers · ตาราง `posMenuRank` (**1.14.11**)
- [x] จิ้มเมนู → จ่าย → ใบเสร็จ → รีเซ็ต · ลิ้นชักตอนสด

## คิวถัดไป (เฟสก่อนหน้าที่ยังไม่ทำ)
| เฟส | โฟกัส | สถานะ | ทำไมค้าง |
|-----|--------|--------|----------|
| **F0–F5** | ไหลขายพนักงาน · ตัดทานที่ร้าน · ล้างตะกร้า · PromptPay เว็บ | ⬜ | ดู [npos-sell-flow-polish-checklist.md](./npos-sell-flow-polish-checklist.md) |
| **R0–R5** | จัดลำดับขายดี · โหมด fix / bestsellers | ✅ R0–R4 | **1.14.11** · ค้างคนเทส R5 |
| **S3 / P4** | คนเทสหน้าร้านจริง | ⬜ | ต้องคนที่เคาน์เตอร์ |
| **P5** | feedback จากนำร่อง | ⬜ | รอ P4 |
| **W6** | สื่อโปรโมจากหลังร้านบนจอ Idle | ⬜ | คู่ขนาน · ยังไม่เริ่ม |
| **Room / SQLite** | Local DB บนเครื่อง (BO = Firebase) | ⬜ | เมื่อคิวโต · L1 แคชพอใช้แล้ว |
| **B1–B4** | ปิดกะ blind (Wongnai-style) | ✅ | **1.14.10** |

## ตัดออกตามนโยบาย
- **N7 ตัดเว็บขาย** — ไม่ทำ (ไม่มีสต๊อกดัน)

## นอกสcope
- ทานที่ร้าน / รับกลับ / Delivery · สลิปครัว / KDS · PromptPay auto cut-off · โน้ตบิล · คูปอง/สมาชิก · บัตร/โอน  

## คู่ขนานได้
- [ ] **F0–F5** ไหลขายพนักงาน — ตัดทานที่ร้าน · ล้างตะกร้า · PromptPay เว็บ ([เช็คลิสต์](./npos-sell-flow-polish-checklist.md))
- [x] **R1–R4** เก็บขายดี 7→14 วัน · หลังร้านโหมด fix / กลุ่มขายดี · POS auto (**1.14.11**)
- [ ] Local DB first / Room บนเครื่อง เมื่อคิวโต (หลังร้านยัง Firebase)
- [ ] สื่อโปรโมจากหลังร้านบนจอลูกค้า (W6)
- [x] qty-per-option ละเอียดเท่าเว็บ (1.14.9)

```bash
node scripts/check-npos-shop.mjs
# หรือเร็ว: SKIP_CAPTURE_SMOKE=1 node scripts/check-npos-shop.mjs
```
