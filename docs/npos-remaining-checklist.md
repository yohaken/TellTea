# nPos — เศษงาน (สcope เรียบ · หน้าร้านขาเร็ว)

อัปเดต: **1.14.3** W1–W3 เช็คงาน + option ในตะกร้า + layout 65/35  
ดู [npos-shop-work-checklist.md](./npos-shop-work-checklist.md) · สcope [npos-master-sell-phases.md](./npos-master-sell-phases.md)

## ทำแล้ว
- [x] แคปจอ media-proxy — รูปจริงใน BO (**1.14.2**)
- [x] จอลูกค้าสองพาเนล + 4 โหมด
- [x] โคลนผังขาย + local-first เมนู/รูป
- [x] **W1** ระบบเช็คงาน `check-npos-shop.mjs`
- [x] **W2** option ใต้ตะกร้า / จอลูกค้า / ใบเสร็จ
- [x] **W3** layout พนักงาน weight 65/35
- [x] จิ้มเมนู → จ่าย → ใบเสร็จ → รีเซ็ต · ลิ้นชักตอนสด

## คิวถัดไป
| เฟส | โฟกัส | สถานะ |
|-----|--------|--------|
| **S3 / P4** | คนเทสหน้าร้านจริง | ⬜ |
| **P5–P6** | feedback · void เซิร์ฟเวอร์ | ⬜ |
| **N7** | ตัดเว็บขาย | ⬜ |

## นอกสcope
- ทานที่ร้าน / รับกลับ · สลิปครัว / KDS · PromptPay auto cut-off · โน้ตบิล  

## คู่ขนานได้
- [ ] Local DB first (outbox ชัดขึ้น)
- [ ] สื่อโปรโมจากหลังร้านบนจอลูกค้า

```bash
node scripts/check-npos-shop.mjs
# หรือเร็ว: SKIP_CAPTURE_SMOKE=1 node scripts/check-npos-shop.mjs
```
