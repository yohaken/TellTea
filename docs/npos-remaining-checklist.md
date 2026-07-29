# nPos — เศษงาน (สcope เรียบ · หน้าร้านขาเร็ว)

อัปเดต: **1.14.72** + แผน **Exclusive seat S1–S4** · friction F0–F5  
ดู [npos-friendly-ui-checklist.md](./npos-friendly-ui-checklist.md) · [npos-bank-transfer-pay-checklist.md](./npos-bank-transfer-pay-checklist.md) · [npos-shift-panel-pulse-interval-checklist.md](./npos-shift-panel-pulse-interval-checklist.md) · [npos-force-update-pulse-checklist.md](./npos-force-update-pulse-checklist.md) · [npos-sales-history-compact-checklist.md](./npos-sales-history-compact-checklist.md) · [npos-version-on-sync-checklist.md](./npos-version-on-sync-checklist.md) · [npos-version-prod-verify-checklist.md](./npos-version-prod-verify-checklist.md) · [npos-sales-history-checklist.md](./npos-sales-history-checklist.md) · [npos-sell-counter-polish-checklist.md](./npos-sell-counter-polish-checklist.md) · [npos-kick-reclaim-checklist.md](./npos-kick-reclaim-checklist.md) · [npos-exclusive-seat-checklist.md](./npos-exclusive-seat-checklist.md) · [npos-counter-ux-batch-checklist.md](./npos-counter-ux-batch-checklist.md) · [npos-ops-friction-phases.md](./npos-ops-friction-phases.md) · [npos-doc-drawer-polish-checklist.md](./npos-doc-drawer-polish-checklist.md) · [npos-sell-table-pay-checklist.md](./npos-sell-table-pay-checklist.md) · [npos-shift-dashboard-checklist.md](./npos-shift-dashboard-checklist.md) · [npos-option-cart-wrap-checklist.md](./npos-option-cart-wrap-checklist.md) · [npos-customer-focus-checklist.md](./npos-customer-focus-checklist.md) · [npos-store-claim-checklist.md](./npos-store-claim-checklist.md) · [npos-shop-work-checklist.md](./npos-shop-work-checklist.md) · [npos-blind-shift-close-checklist.md](./npos-blind-shift-close-checklist.md) · [npos-option-qty-parity-checklist.md](./npos-option-qty-parity-checklist.md) · [npos-bestseller-rank-checklist.md](./npos-bestseller-rank-checklist.md) · [npos-sell-flow-polish-checklist.md](./npos-sell-flow-polish-checklist.md) · [npos-receipt-parity-checklist.md](./npos-receipt-parity-checklist.md) · [npos-receipt-readable-checklist.md](./npos-receipt-readable-checklist.md) · [npos-thermal-all-docs-checklist.md](./npos-thermal-all-docs-checklist.md) · [npos-void-cashout-reason-checklist.md](./npos-void-cashout-reason-checklist.md) · [npos-z-report-form-checklist.md](./npos-z-report-form-checklist.md) · [npos-z-web-form-parity-checklist.md](./npos-z-web-form-parity-checklist.md) · [npos-z-report-align-checklist.md](./npos-z-report-align-checklist.md) · [npos-z-cash-remit-checklist.md](./npos-z-cash-remit-checklist.md) · [npos-capture-projection-checklist.md](./npos-capture-projection-checklist.md) · [npos-change-display-setting-checklist.md](./npos-change-display-setting-checklist.md) · [npos-system-ver-sync-checklist.md](./npos-system-ver-sync-checklist.md) · [npos-customer-type-scale-checklist.md](./npos-customer-type-scale-checklist.md) · [npos-bo-shift-readonly-checklist.md](./npos-bo-shift-readonly-checklist.md) · [npos-cut-bo-entry-checklist.md](./npos-cut-bo-entry-checklist.md) · [npos-float-shift-p0-checklist.md](./npos-float-shift-p0-checklist.md) · [npos-bo-sales-retention-plan.md](./npos-bo-sales-retention-plan.md) · [npos-receipt-history-staff.md](./npos-receipt-history-staff.md)

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
- [x] **Cut C1–C4** ตัดช่องทางเคาน์เตอร์ → หลังร้าน/เว็บ BO (**1.14.20**)
- [x] **Float P0** แก้เด้งเข้างาน + seed leave float + การ์ดทอนรอบถัดไป (**1.14.21**)
- [x] **Z web form** สลิปปิดกะโคลนฟอร์มเว็บเฟรมต่อเฟรม (**1.14.23**)
- [x] **Store claim** รหัสร้าน · เคลมเครื่อง · บล็อกเขียนขาย · จำที่อยู่ (**1.14.24**)
- [x] **Doc + drawer** เอกสารร้าน (ชื่อร้านเรา · ไม่ลอกแบรนด์คู่แข่ง) · CashDrawerPolicy (**1.14.42**)
- [x] **Sales history H0–H2** list+detail · กรองรอบ/วันนี้ · ค้นหาเลขบิล · BO รายละเอียด (**1.14.42**)
- [x] **Counter sell C0–C4** ตัดราคาส่ง · สรุปยอด · จัดปุ่ม · แถวตะกร้า · หัวบิล/พักบิล (**1.14.42**) · PromptPay native ฝาก
- [x] **Version-on-sync V0–V1** heartbeat/sync pulse เช็คเวอร์ชัน · BO/POS โฟกัส+pulse (**1.14.43**)
- [x] **Sales history compact** custom วัน · BO สลิปเต็มพื้นที่ · หมวดพับ · ค้นหาลูกค้า/VAT ถ้ามี (**1.14.45**)
- [x] **Force update pulse** ชีพจรบังคับอัปเดต · ป๊อบกลับมาหลังปิดสั้นๆ · ซ่อนรีเฟรชหน้าร้าน (**1.14.47**)
- [x] **Shift panel + pulse interval** แผงรอบขาย · ถอนกลางกะ · `heartbeatIntervalSec` จาก BO (**1.14.48**)
- [x] **Bank transfer tender** ปุ่มโอนเงิน (สลิป/บัญชีร้าน) · ไม่ลิ้นชัก · แยกสรุปรอบ (**1.14.49**)
- [x] **BO slim sessions** ตารางรอบ super slim · ชีพจรในหัวตาราง · ปุ่มเป็นข้อความ (**1.14.50**)
- [x] **BO slim filters** สรุปหนึ่งบรรทัด · กรองเปิด/เครื่อง/รอบ · fold ตัดการ์ด (**1.14.51**)
- [x] **BO manage slim** แท็บจัดการ hairline/text · ตารางเครื่อง slim (**1.14.52**)
- [x] **Session ≠ OT** รายงานใช้รอบ nPos realtime · ตัดเช้า/เย็น · เก็บถอนตอนปิด (**1.14.53**)
- [x] **Gpos chrome** กริดฮับซ้ายบน · ค้นหา · ตะกร้า −/qty/+ · ซ่อนแถบซ้ายหน้าขาย (**1.14.54**)
- [x] **Force update + session sync** ปิด Later snooze · ซ่อม date Bangkok · ซิงก์รอบค้าง (**1.14.55**)
- [x] **Sell table-pay** หมวดซ้ายแนวตั้ง · ชำระทั้งหมด+ยอดในปุ่ม · บันทึกพักบิล (**1.14.56**)
- [x] **Shift dashboard + search icon** แผง 30/70 · 3 การ์ด · ประวัติรอบ · ค้นหาไอคอน · ตะกร้า ~16 (**1.14.57**)
- [x] **Option jump + cart wrap** ตกลง→เลื่อนกลุ่มบังคับ · ตะกร้าตัดบรรทัด · ออปชันแนวตั้ง (**1.14.58**)
- [x] **Customer focus + prod verify MD** จอลูกค้าโฟกัสรายการ · หลังจ่ายค้างเช็ค · checklist ตรวจ latest.json (**1.14.59**)
- [x] **Pay chooser touch** เลิก `setItems` รายการบาง · ปุ่มใหญ่เงินสด/โอน + MD friendly-ui #8 (**1.14.60**)
- [x] **BO sessions slim super** รหัสเครื่อง/รอบ · วันที่ · เลิก date slider · 50 แถว scroll · ปิดกะ flush→เซิร์ฟก่อนออกงาน (**1.14.61**)
- [x] **Cart layout touch** ตะกร้า 35% · แถวข้อความส่วนลด/พัก/ล้าง · ชำระสูง ~18% · ปุ่มกลับใหญ่ (**1.14.65**)
- [x] **Z report align** คอลัมน์บิล≠ยอด · เช็คลิสก่อนเซ็นบนสลิป Z (**1.14.72**)
- [x] **System ver sync** pin «เวอร์ชันระบบ» = APK · CORS latest.json · เกต CI (**1.14.72** / APP 364)
- [x] **Customer type scale** จอลูกค้า 10.1" อิง 600px · body~19sp · Prompt (**1.14.73**)
- [x] จิ้มเมนู → จ่าย → ใบเสร็จ → รีเซ็ต · ลิ้นชักตอนสด

## คิวถัดไป (เฟสก่อนหน้าที่ยังไม่ทำ)
| เฟส | โฟกัส | สถานะ | ทำไมค้าง |
|-----|--------|--------|----------|
| **Shop settings persist** | ชื่อ/ที่อยู่หลังบ้าน → Firebase → ใบเสร็จ | ✅ | **1.14.42** · แก้ local ทับ cloud + reload native |
| **Friction F0–F5** | เคลม UX · ลิ้นชัก≠พิมพ์ · กะออฟไลน์ · tip | ⬜ แผน | ดู `npos-ops-friction-phases.md` · รองจาก seat |
| **Doc + drawer** | เอกสารร้าน · ลิ้นชัก policy · ติดตั้งฮาร์ด | ✅ | **1.14.42** · ค้างคนเทสเคาน์เตอร์ |
| **Store claim** | รหัสร้าน · บล็อกเครื่องไม่มีรหัส (multi) | ✅ | **1.14.24** · ต่อด้วย exclusive seat |
| **Z web form** | สลิป Z = ฟอร์มเว็บ | ✅ | **1.14.23** |
| **Float P0** | เด้งเข้างาน · leave float · การ์ด BO | ✅ | **1.14.21** |
| **Cut C1–C5** | ตัดทางเข้าหลังร้านจากเคาน์เตอร์ | ✅ C1–C4 | **1.14.20** · ค้างคนเทส C5 |
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
- [x] **Friendly UI type** ฟอนต์ Prompt + ปุ่ม/ตัวอักษรเป็นมิตร (**1.14.33**)
- [x] **เข้างาน→ขายทันที** · dialog เหตุเตะ · HB ~5s + ชิป BO · จำรหัสร้าน · ปุ่มขายแถวยาว+ไอคอน (**1.14.42**)
- [x] **Compact buttons** wrap_content · max 280dp · ไม่ยืดเต็มจอ (**1.14.42**)
- [x] **Friendly UI sweep** NposUi ทั้งแอป + นโยบายฝังงานใหม่ · แถบซ้าย/จอลูกค้า/option (**1.14.42**)
- [x] **Kick bounce จากหน้าขาย** NposApp CLEAR_TOP เมื่อถูกเตะ + HB force ~5s + ชิปนับถอยหลัง (**1.14.42**)
- [x] **POS number pad** ทอนเปิดกะ · ปิดกะ · เคลม · เงินสด · ดึงเงิน — `padKeyMinPxForChrome` + `padAmountMinPx` (**1.14.71**)
- [x] **บิลย้อนหลัง + หมวดเมนู** การ์ด Npos · ชิปหมวดใหญ่ขึ้น (**1.14.42**)
- [x] **Link status orb** เขียว/เหลือง/แดง + นับถอยหลัง BO (**1.14.42**)
- [x] **BO รหัสเต็ม + ตารางรอบ/ยอด** · แผนเก็บยอด `npos-bo-sales-retention-plan` (**1.14.42**)
- [x] **P1 ค้างส่ง + P2 สด/PP สด** · heartbeat outbox · session cash/PP live · ประวัติบิลพนักงาน (**1.14.42**)
- [x] **Kick-reclaim K1–K3** ปุ่มเตะในตาราง · เปลี่ยนรหัส = เตะทุกเครื่อง · client อัป hash + เด้งใส่รหัส (**1.14.42**) — ค้างคนเทส
- [x] **Exclusive seat S1–S4** เครื่องเดียว + ตาราง slim + เตะ + resume กะ + ด่านอัปเดต (**1.14.42**) — ค้างคนเทส
- [ ] **Friction F0–F5** คนเทส + เคลม UX + ลิ้นชัก≠พิมพ์ + กะออฟไลน์ — `npos-ops-friction-phases.md`
- [x] **Counter UX batch** แบดจ์จำนวน · นาฬิกากะ · ซ่อน QR · โลโก้ (**1.14.42**)
- [x] **Doc + drawer** เอกสารร้าน + ลิ้นชัก policy (**1.14.42**)
- [x] **Store claim** รหัสร้าน · เคลมเครื่อง · บล็อกเขียน (**1.14.24**)
- [x] **Z web form** สลิปปิดกะ = ฟอร์มเว็บ (**1.14.23**)
- [x] **Float P0** แก้เด้งเข้างาน + leave float (**1.14.21**)
- [x] **Cut C1–C4** ตัดช่องทางเคาน์เตอร์ → หลังร้าน (**1.14.20**)
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
