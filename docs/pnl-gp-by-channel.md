# หัก GP รายช่องทาง → P&L

> หน้า `/vat-sales/` แท็บปิด P&L · ตาราง「รายได้แยก → P&L」  
> อัปเดต 2026-07-29

---

## ทำไมต้องแยก

หน้าร้าน ≠ เดลิเวอรี่ · และเดลิเวอรี่แต่ละแพลตฟอร์ม GP ไม่เท่ากัน  
ห้ามเหมารวมเรทเดียวทั้งก้อน

```
รายได้ ShopeeFood  → หัก GP ของ Shopee (% หรือยอดบาท)
รายได้ Grab        → หัก GP ของ Grab
รายได้ LINE MAN    → หัก GP ของ LINE MAN
รายได้หน้าร้าน     → หักแยก (ค่าเริ่ม 0%)
        ↓
รายได้สุทธิ → P&L
```

---

## โหมดต่อช่องทาง

| โหมด | ความหมาย |
|------|----------|
| **เรท %** | `รายได้ช่องทาง × %` |
| **ยอดบาท** | ใส่ยอดหัก fix |

เรท/% ที่ตั้งไว้ **จำในตั้งค่าร้าน** (`meta/vatMonthlySettings.pnlGpByChannel`) ใช้เดือนถัดไปอัตโนมัติ · และเซฟในเอกสารเดือนด้วย

---

## ยอดช่องทางมาจากไหน

ตารางภาษีขาย (เดลิเวอรี่) — แยก Shopee / Grab / LINE MAN  
ถ้ายังไม่แยก ระบบใส่ยอดรวมที่แถว Grab ชั่วคราว — ควรแยกในตารางขายก่อน

---

## โค้ด

- `src/lib/personal-income-tax.ts` — `buildIncomeBridge` · `gpByChannel` · `mapGpByChannel`
- `src/lib/vat-monthly.ts` — `pnlGpByChannel` ใน return + settings
- UI: `VatMonthlyWorkbench` → `IncomeBridgeTable`

ตัวเลขเงิน: [`vat-number-format.md`](./vat-number-format.md)
