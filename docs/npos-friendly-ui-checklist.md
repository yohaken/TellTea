# nPos — Friendly UI (บังคับใช้ต่อจากนี้)

อัปเดต: **1.14.34** · ฟอนต์ Prompt + ปุ่ม/ตัวอักษรเป็นมิตร

## นโยบายล็อก (งานใหม่ทุกชิ้น)

1. **ห้าม** สร้าง `new Button()` / Material แถบหนา / `Typeface.DEFAULT*` สำหรับ UI ที่ผู้ใช้เห็น  
2. **ต้อง** ใช้ `app.telltea.npos.ui.NposUi` (ปุ่ม/หัวข้อ/ช่องกรอก) + `NposFonts`  
3. Layout XML ใช้สไตล์ `Npos.Btn.*` / `Npos.Text.*` / `Theme.Npos` — ไม่ฮาร์ดโค้ดม่วงหรือครีมเทอร์ราคอตตา  
4. ปุ่มหลักสูง ~52dp · รอง/ghost ~40–44dp · งานย่อยเป็น **chip** ไม่ยืดเต็มจอโดยไม่จำเป็น  
5. สีแบรนด์: ส้ม `#E85D24` · หมึก `#1A2E24` · พื้น `#F7F7F5` (`colors.xml`)

ถ้าเพิ่มหน้าจอ/ไดอะล็อก/แผงตัวเลขใหม่แล้วไม่ผ่านเกตด้านล่าง = ยังไม่ ship

## โมดูล
| ไฟล์ | หน้าที่ |
|------|---------|
| `ui/NposUi.java` | factory ปุ่ม/ตัวอักษร/ช่องกรอก/หัวหน้า |
| `ui/NposFonts.java` | Prompt typeface |
| `res/values/styles.xml` | `Theme.Npos` · `Npos.Btn.*` |
| `res/values/colors.xml` · `dimens.xml` | โทน + ขนาดทัช |

## สิ่งที่รีสกินแล้ว
- Settings · เข้างาน/เคลม · update popup  
- หน้าขาย (ปุ่มจ่าย + ปุ่มรอง + ไดอะล็อกตัวเลือก + pad จ่ายเงิน)  
- ใบเสร็จ · กะ · เปิด/ปิดกะ · diagnose  
- แถบซ้าย / หัวบาร์ขาย · จอลูกค้า (โทนตัวอักษร)

## ตรวจ
```bash
node scripts/test-npos-friendly-ui.mjs
```
