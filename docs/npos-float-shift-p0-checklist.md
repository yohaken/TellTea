# nPos — Float open crash + P0 leave float

อัปเดต: **1.14.21** · ship **1.14.23** · `APP_BUILD` 254 · `POS_BUILD` 74 · `versionCode` 45  

## อาการที่รายงาน
กดเข้างาน → กรอกเงินทอน (เช่น 500) → แอปเด้งปิด · เปิดใหม่แล้วยังอยู่ในกะ

## สาเหตุ / แก้
| จุด | ปัญหา | แก้ |
|-----|--------|-----|
| `shift_summary_fmt` | `Resources.getString` + `%2$.0f` / double → บางเครื่อง IllegalFormat → process death หลังเปิดกะสำเร็จ | เงินเป็น `%s` ผ่าน `ShiftPrefs.summaryLine` |
| `setNextOpeningCash` + `open()` | `apply()` แข่งกับ thread เปิดกะ | ส่ง `openingCash` เข้า `openSession` ตรงๆ · prefs ใช้ `commit()` |
| UI หลังเปิด | exception ใน callback ทำให้รู้สึกว่าแอปพัง | try/catch + `isFinishing` guard |

## P0 Wongnai float
- [x] Seed leave float = min(opening, counted) แทน `0`
- [x] Block ถ้า leave > counted
- [x] โชว์ทอนรอบถัดไปบน `SessionShiftCard` หลังบ้าน

## ตรวจ
```bash
node scripts/test-npos-float-shift-p0.mjs
SKIP_CAPTURE_SMOKE=1 node scripts/check-npos-shop.mjs
```
