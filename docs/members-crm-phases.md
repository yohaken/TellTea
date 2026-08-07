# สมาชิก / สะสมแต้ม — เฟสและเช็กลิสต์

บัตรสมาชิก + แต้ม · สาขาเดียว · หลังร้าน + หน้าร้าน · โครงเผื่อ QR สมัครเอง (M4)

## สรุปเฟส

| เฟส | สถานะ | ส่งมอบ |
|-----|--------|--------|
| **M0 โครง** | ✅ | types, collections, rules, permissions, nav, `/members` |
| **M1 CRM หลังร้าน** | ✅ | CRUD สมาชิก, ledger แต้ม, ตั้งค่าอัตราแต้ม |
| **M2 POS** | ⬜ | ค้นหา/สมัครเร็ว/ผูกบิล, earn ตอนปิดบิล (nPos) |
| **M3 แลกแต้ม** | ⬜ | redeem บนบิล + ใบเสร็จ |
| **M4 QR สมัครเอง** | ⬜ | หน้า public + token + โบนัสสมัคร |

---

## M0 — โครงพื้นฐาน

- [x] Types: `ShopMember`, `MemberLedgerEntry`, `MemberSettings`, sources
- [x] Lib: `src/lib/members.ts` (CRUD, ledger txn, settings)
- [x] Permissions: `membersView` · `membersManage` · `membersAdjustPoints`
- [x] Firestore rules: `members`, `memberLedger` + `meta/memberSettings` write
- [x] Index: `memberLedger` (`memberId` + `createdAt`)
- [x] Nav: อื่นๆ → สมาชิก / แต้ม · `MORE_PREFIXES`
- [x] หน้า `/members/` + bump `APP_BUILD`
- [x] เอกสารเฟสนี้

## M1 — CRM หลังร้าน

- [x] รายการ + ค้นหาเบอร์/ชื่อ/เลขบัตร
- [x] สมัครสมาชิก (เบอร์ unique = doc id)
- [x] แก้โปรไฟล์ / ระงับ–เปิดใช้
- [x] ปรับแต้มมือ + เหตุผล → `memberLedger`
- [x] ประวัติแต้มต่อสมาชิก
- [x] ตั้งค่า: เปิดระบบ, อัตราแต้ม, โบนัสสมัคร, ธง `publicSignupEnabled` (ยังไม่เปิด UI สาธารณะ)

## M2 — POS (ยังไม่ทำ)

- [ ] เปิดเมนูสมาชิกบน nPos (เลิกซ่อน)
- [ ] ค้นหาเบอร์ / สมัครเร็วที่เคาน์เตอร์
- [ ] ผูก `memberId` บน `posSales`
- [ ] ปิดบิล → earn ตาม `memberSettings` + ledger (`earn_sale`)
- [ ] rules: POS device อ่าน/เขียนตามที่ออกแบบ

## M3 — แลกแต้ม

- [ ] คำนวณ redeem จาก settings
- [ ] ledger `redeem` + แสดงบนใบเสร็จ
- [ ] กันยอดติดลบ / สมาชิกระงับ

## M4 — QR สมัครเอง

- [ ] หน้า public แยกจาก staff auth
- [ ] signup token จาก `memberSettings`
- [ ] `source: qr_self` + โบนัสสมัครผ่าน ledger
- [ ] ไม่อนุญาตให้โลกเขียน `members` ตรงๆ โดยไม่มี token

---

## ข้อมูลหลัก

| Collection / doc | บทบาท |
|------------------|--------|
| `members/{phoneDigits}` | โปรไฟล์ + `pointsBalance` (cache) |
| `memberLedger/{id}` | ความจริงของแต้มทุกครั้งที่เปลี่ยน |
| `meta/memberSettings` | กฎร้าน + ธง QR อนาคต |

**ตัวตน = เบอร์** (`normalizePhone` → digits เป็น doc id)  
**อย่าปนกับ** `staff` / `/staff` (พนักงาน)
