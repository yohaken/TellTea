# nPos — เศษงาน (สcope เรียบ · หน้าร้านขาเร็ว)

อัปเดต: **1.14.5** C1–C4 แคปเต็มละเอียด · ล้างรูป · เก็บ ≤50  
ดู [npos-shop-work-checklist.md](./npos-shop-work-checklist.md) · [npos-capture-checklist.md](./npos-capture-checklist.md)

## ทำแล้ว
- [x] แคปจอ media-proxy — รูปจริงใน BO (**1.14.2**)
- [x] จอลูกค้าสองพาเนล + 4 โหมด
- [x] โคลนผังขาย + local-first เมนู/รูป
- [x] **W1–W5** เช็คงาน · option · layout 65/35 · outbox · void เซิร์ฟเวอร์
- [x] **C1–C4** ล้างรูป · แสดงเต็มละเอียด · เก็บ ≤50 · POS แคปเต็มละเอียด
- [x] จิ้มเมนู → จ่าย → ใบเสร็จ → รีเซ็ต · ลิ้นชักตอนสด

## คิวถัดไป (เฟสก่อนหน้าที่ยังไม่ทำ)
| เฟส | โฟกัส | สถานะ | ทำไมค้าง |
|-----|--------|--------|----------|
| **S3 / P4** | คนเทสหน้าร้านจริง | ⬜ | ต้องคนที่เคาน์เตอร์ |
| **P5** | feedback จากนำร่อง | ⬜ | รอ P4 |
| **N7** | ตัดเว็บขาย | ⬜ | หลัง P4–P5 |
| **W6** | สื่อโปรโมจากหลังร้านบนจอ Idle | ⬜ | ยังไม่เริ่ม |

## นอกสcope
- ทานที่ร้าน / รับกลับ · สลิปครัว / KDS · PromptPay auto cut-off · โน้ตบิล  

## คู่ขนานได้
- [ ] Local DB first / Room แทน SharedPreferences เมื่อคิวโต
- [ ] สื่อโปรโมจากหลังร้านบนจอลูกค้า (W6)

```bash
node scripts/check-npos-shop.mjs
# หรือเร็ว: SKIP_CAPTURE_SMOKE=1 node scripts/check-npos-shop.mjs
```
