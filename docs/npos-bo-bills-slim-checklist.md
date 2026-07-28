# nPos — BO bills slim fold + force-close (ทดลอง)

อัปเดต: **1.14.65** · `APP_BUILD` 323 · `POS_BUILD` 118 · vc **88**

## มติ

| ข้อ | ทำ |
|-----|----|
| รายการบิลล่าสุด | หุบใน `<details>` เป็นค่าเริ่ม · เปิดเมื่อเลือกรอบ |
| ตาราง | superslim · โหลดทีละ `POS_BILLS_SLIM_PAGE` (25) · เลื่อนลงโหลดเพิ่ม · ใหม่→เก่า |
| สลิป | `PosReceiptPaper` ด้านขวาเหมือนเดิม |
| คอลัมน์ | กระชับ · รหัสรอบซ่อนเมื่อจอแคบ (`.npos-slim-col-session`) |
| ปิดรอบจาก BO | คอลัมน์ **ปิด** บนรอบเปิด · `closePosSessionAdmin` · `closeSource: bo-force` · ช่วงทดลอง 3–5 วัน |

```bash
node scripts/test-npos-bo-bills-slim.mjs
node scripts/test-npos-bo-sessions-super.mjs
```
