# nPos — Friendly UI (บังคับใช้ต่อจากนี้)

อัปเดต: **1.14.71** · แป้นเงินสด/เปิดกะ/ปิดกะ/เคลม fit-to-window · **ห้าม** `AlertDialog.setItems` รายการบาง

## นโยบายล็อก (งานใหม่ทุกชิ้น)

1. **ห้าม** สร้าง `new Button()` / Material แถบหนา / `Typeface.DEFAULT*` สำหรับ UI ที่ผู้ใช้เห็น  
2. **ต้อง** ใช้ `app.telltea.npos.ui.NposUi` (ปุ่ม/หัวข้อ/ช่องกรอก) + `NposFonts`  
3. Layout XML ใช้สไตล์ `Npos.Btn.*` / `Npos.Text.*` / `Theme.Npos` — ไม่ฮาร์ดโค้ดม่วงหรือครีมเทอร์ราคอตตา  
4. **ตั้งค่า / เข้างาน / hub:** ปุ่มหลักสูง ~52dp · กว้าง **wrap_content** (max ~280dp) จัดกลาง · ใช้ `NposUi.cta()`  
5. **หน้าขาย (ตะกร้า):** ปุ่มเป็นแถวยาว `Npos.Btn.SellRow*` + ไอคอน/อีโมจิในข้อความ — แตะง่ายที่เคาน์เตอร์  
6. **แป้นตัวเลข POS** (เงินสด / ทอนเปิดกะ / ปิดกะ / ดึงเงิน / รหัสเคลม): `NposNumberPad` + `padKeyMinPxForChrome` + `padAmountMinPx` (เป้าหมาย ~56–64dp · หดถึง ~48dp) · chrome: CASH/STANDARD/FLOAT_NOTE/CLAIM · `fitCardToWindow` ถ้ายังล้น — ไม่ใช้ชิปเล็ก  
7. สีแบรนด์: ส้ม `#E85D24` · หมึก `#1A2E24` · พื้น `#F7F7F5` (`colors.xml`)
8. **ห้าม** `AlertDialog.Builder#setItems` / รายการ Material แถวข้อความเล็ก + ปุ่ม CANCEL สำหรับเลือกที่เคาน์เตอร์ (เช่น วิธีชำระ) — **ไม่ใช่ table-first** · ใช้ปุ่มใหญ่ `NposUi.primary/secondary` เต็มความกว้างแทน

ถ้าเพิ่มหน้าจอ/ไดอะล็อก/แผงตัวเลขใหม่แล้วไม่ผ่านเกตด้านล่าง = ยังไม่ ship

## โมดูล
| ไฟล์ | หน้าที่ |
|------|---------|
| `ui/NposUi.java` | factory ปุ่ม/ตัวอักษร/ช่องกรอก/หัวหน้า |
| `ui/NposConfirmDialog.java` | ยืนยัน/เตือน/เนื้อหา — CTA ผ่าน NposUi |
| `ui/NposNumberPad.java` | แป้นตัวเลขเคาน์เตอร์ (สูง) |
| `ui/NposFonts.java` | Prompt typeface |
| `res/values/styles.xml` | `Theme.Npos` · `Npos.Btn.*` · `Npos.Btn.SellRow*` |
| `res/values/colors.xml` · `dimens.xml` | โทน + ขนาดทัช |

## สิ่งที่รีสกินแล้ว
- Settings · เข้างาน/เคลม · update popup  
- หน้าขาย (แถวจ่าย/ส่วนลด/พักบิล + ไอคอน) · หมวด/การ์ดเมนู  
- ใบเสร็จย้อนหลัง (การ์ด + ปุ่มพิมพ์/ทำลาย) · กะ · เปิด/ปิดกะ · diagnose  
- แถบซ้าย / หัวบาร์ขาย · จอลูกค้า · ชิป `BO Ns`  
- ไดอะล็อกยืนยัน (พิมพ์ซ้ำ / ทำลาย / เงินสด / เปิด·ปิดกะ / คิวค้าง / kick)
- **เลือกวิธีชำระ** — ปุ่มใหญ่เงินสด/โอน (**1.14.60**) · ไม่ใช้ `setItems`

## ตรวจ
```bash
node scripts/test-npos-friendly-ui.mjs
node scripts/test-npos-pay-chooser-touch.mjs
```
