# nPos — บังคับอัปเดต + ซิงก์รอบขายเข้าหลังบ้าน

อัปเดต: **1.14.55** · `APP_BUILD` 313 · `POS_BUILD` 108 · vc **78**

## 1) เวอร์ชันต้องล่าสุดเสมอ

| เดิม (บั๊ก) | ใหม่ |
|-------------|------|
| ปุ่ม「ปิดชั่วคราว」snooze ค้าง | ซ่อนปุ่ม Later ทั้งก้อน |
| dismiss ค้างใน prefs | เคลียร์ทุก resume / pulse / check |
| ปิดผิดแล้วต้องฆ่าแอป | pulse + resume โชว์ป๊อบทันทีถ้าเวอร์ชันต่ำกว่า latest |

## 2) รอบขายขึ้นตาราง BO

| สาเหตุ | แก้ |
|--------|-----|
| CF `date` = UTC midnight ≠ BO Bangkok midnight | `functions/bangkok-day.js` ใช้ร่วม · BO `startOfLocalDay` ล็อก Asia/Bangkok |
| รอบเปิดค้าง local ถ้า CF ล้ม | `ensureOpenSessionSynced` ทุก flush + heartbeat |
| เอกสารเก่า date ผิด | heartbeat ซ่อม `date` ของรอบเปิดเครื่องนี้ · BO รวม open + legacy date |

## ตรวจ

```bash
node scripts/test-npos-force-sync.mjs
```
