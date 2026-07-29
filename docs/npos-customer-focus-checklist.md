# nPos — จอลูกค้าโฟกัสรายการ (cart-first)

อัปเดต: **1.14.79** · `APP_BUILD` 394 · `POS_BUILD` 130 · vc **101**  
ตั้งค่าเวลาทอน: ดู [npos-change-display-setting-checklist.md](./npos-change-display-setting-checklist.md)

## พฤติกรรม (ทางเลือก C หลังจ่าย)

| สถานะ | จอลูกค้า |
|--------|-----------|
| ไม่มีรายการ | โปรโมทรูปหมุนเต็มสัดส่วนเดิม |
| มีรายการในตะกร้า | **รายการเต็มจอ** · หุบโปรโมท |
| กำลังชำระ | โชว์ยอด/ทอน (แผงจ่าย) |
| สำเร็จ (ไม่มีทอน) | สแปลช ~3.5 วิ |
| สำเร็จ **มีทอน** | ตามตั้งค่าเครื่อง (ค่าเริ่ม 10 วิ / หรือปิดด้วยตนเอง) · แถบเขียวบนจอขาย |
| หลังสำเร็จ | **ค้างรายการที่จ่ายแล้ว ~12 วิ** (หัวข้อยังมีเงินทอนถ้ามี) · เริ่มบิลใหม่ตัดทันที |

## ตรวจเวอร์ชันขึ้นโปรดักชัน
ดู [npos-version-prod-verify-checklist.md](./npos-version-prod-verify-checklist.md) · รัน `node scripts/smoke-pos-install-live.mjs`

```bash
node scripts/test-npos-customer-focus.mjs
```
