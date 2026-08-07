# สมาชิก / สะสมแต้ม — เฟสและเช็กลิสต์

บัตรสมาชิก + แต้ม · สาขาเดียว · **ช่วงแรก = หลังร้านเท่านั้น**

## ความปลอดภัยต่อระบบร้านที่ใช้อยู่

- **หลังร้าน = เจ้าของร้านเท่านั้น** (`role === owner`)
- **ค่าเริ่มต้นระบบสมาชิก = ปิด** จนกว่าเจ้าของเปิดที่ตั้งค่า
- **ไม่แตะ APK / UI เคาน์เตอร์ในเฟสนี้** — เครื่องหน้าร้านใช้ของเดิม
- บิลไม่มี `memberId` = path ขายเดิม (server รับฟิลด์ optional ไว้ก่อนได้)
- สะสมแต้มบนเซิร์ฟเวอร์ทำหลัง commit — ไม่บล็อกขาย

## สรุปเฟส

| เฟส | สถานะ | ส่งมอบ |
|-----|--------|--------|
| **M0 โครง** | ✅ | types, collections, rules, permissions, `/members` |
| **M1 CRM หลังร้าน** | ✅ | CRUD · ledger · ตั้งค่า · เจ้าของเท่านั้น |
| **M2 POS เคาน์เตอร์** | ⬜ วางเฟสแล้ว | คีย์เบอร์ผูกสมาชิกบน nPos — ดู [members-redeem-phases.md](./members-redeem-phases.md) |
| **M3 แลกแต้มเคาน์เตอร์** | ⬜ วางเฟสแล้ว | ใช้แต้มตอนคิดเงิน + ข้อมูลบนบิล/แดชบอร์ด — ดู [members-redeem-phases.md](./members-redeem-phases.md) (D0–D5) |
| **M4 QR สมัครเอง** | ✅ โครง | `/join/?t=` + CF (เปิดใช้เมื่อตั้งค่า) |
| **R0–R2 QR บนสลิป** | ✅ โค้ดทดลอง | ธง+`/claim`+ออก QR หลังร้าน — ดู [members-receipt-qr-phases.md](./members-receipt-qr-phases.md) · **ยังไม่ขายจริง / ไม่แตะ APK** |
| **ใช้แต้ม + ข้อมูลบิล/แดชบอร์ด** | ⬜ D0 ล็อกสัญญา | [members-redeem-phases.md](./members-redeem-phases.md) — สัญญาฟิลด์ · สลิป · หลังร้าน · แดชบอร์ด · void |

## ลิงก์หลังร้าน

https://telltea-shop.web.app/members/

## Deploy

1. Hosting หลังร้าน + Firestore rules/indexes  
2. Cloud Functions (lookup/earn/QR) — ไม่บังคับอัป APK  
3. **ไม่** บังคับ OTA nPos ในเฟสนี้  
