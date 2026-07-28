# nPos — cart layout touch (ตะกร้า 35% · แถวข้อความ · ชำระสูง · กลับใหญ่)

อัปเดต: **1.14.62** · `APP_BUILD` 320 · `POS_BUILD` 115 · vc **85**

## มติ

| ข้อ | ทำ |
|-----|----|
| ตะกร้าแกน X | สัดส่วน **14 / 51 / 35** (หมวด / กริด / ตะกร้า) |
| เครื่องมือตะกร้า | แถวข้อความเดียวด้านบน: ส่วนลด · ดึงบิลพัก · **ล้างตะกร้า** (ส้ม) · ขนาดฟอนต์เท่าชื่อรายการ |
| ไม่ซ่อนใน hub ▦ | ตัดส่วนลด/พัก/ล้างออกจาก PopupMenu |
| ชำระทั้งหมด แกน Y | `cartPayBar` weight **18** (รายการ 82) · `payPrimaryMinPx` ~72dp |
| ปุ่มกลับ | `Npos.Btn.Back` / `NposUi.BACK` สูง ~52dp · ส้ม secondary · option picker ใช้กลับใหญ่ |

```bash
node scripts/test-npos-cart-layout-touch.mjs
node scripts/test-npos-sell-table-pay.mjs
```
