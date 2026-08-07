# สมาชิก / สะสมแต้ม — เฟสและเช็กลิสต์

บัตรสมาชิก + แต้ม · สาขาเดียว · หลังร้าน + หน้าร้าน · QR สมัครเอง

## ความปลอดภัยต่อระบบร้านที่ใช้อยู่

- **หลังร้าน = เจ้าของร้านเท่านั้น** (role `owner` · สิทธิ์อยู่ในระบบเป็น elevated / มอบพนักงานไม่ได้)
- **ค่าเริ่มต้นระบบสมาชิก = ปิด** (`memberSettings.enabled` ต้องเปิดเองที่หลังร้าน)
- บิลที่ไม่มี `memberId` = path ขายเดิมทุกประการ (เงินสด/โอน/ลำดับบิล/ปิดกะ)
- สะสมแต้มทำ **หลัง** commit บิล — ล้มเหลวไม่ยกเลิกบิล
- แลกแต้มทำงานเฉพาะเมื่อส่ง `pointsToRedeem > 0` เท่านั้น
- APK เก่าไม่รู้จักฟิลด์สมาชิก → ขายต่อได้ตามเดิม
- QR สมัครแยกหน้า `/join` + CF โทเคน — ไม่แตะเคาน์เตอร์

## สรุปเฟส

| เฟส | สถานะ | ส่งมอบ |
|-----|--------|--------|
| **M0 โครง** | ✅ | types, collections, rules, permissions, nav, `/members` |
| **M1 CRM หลังร้าน** | ✅ | CRUD สมาชิก, ledger แต้ม, ตั้งค่าอัตราแต้ม |
| **M2 POS** | ✅ | ผูกสมาชิก optional + earn หลังขาย + lookup/สมัครเร็ว (เปิดเมื่อ enabled) |
| **M3 แลกแต้ม** | ✅ | `pointsToRedeem` ในบิล · หักแต้มใน txn เดียวกับขาย |
| **M4 QR สมัครเอง** | ✅ | `/join/?t=` + `publicMemberSignup` |

---

## M0 — โครงพื้นฐาน

- [x] Types / lib / permissions / rules / index / nav / `/members`

## M1 — CRM หลังร้าน

- [x] รายการ · สมัคร · แก้ · ระงับ · ปรับแต้ม · ตั้งค่า

## M2 — POS (ปลอดภัย)

- [x] `PosSale.memberId?` + mapper
- [x] `nposCompleteSale` รับ member แบบ optional
- [x] earn หลัง commit (`tryEarnPointsForSale`) — ไม่บล็อกขาย
- [x] void → คืนแต้ม best-effort (`void_reverse`)
- [x] `nposMemberLookup` / `nposMemberQuickCreate` (Admin SDK)
- [x] `nposShopSettings` ส่ง `membersEnabled` (default false)
- [x] nPos ปุ่มสมาชิกบนขาย — **แสดงเมื่อเปิดระบบเท่านั้น**
- [x] APK versionCode 138

## M3 — แลกแต้ม

- [x] `pointsToRedeem` → ส่วนลดใน sale txn + ledger `redeem`
- [x] UI ใส่จำนวนแต้มแลกในไดอะล็อกสมาชิก
- [x] บิลไม่มี redeem = คำนวณยอดเหมือนเดิม

## M4 — QR สมัครเอง

- [x] หน้า `/join/?t=TOKEN` (ไม่ใช้ AuthGate)
- [x] `publicMemberSignup` ตรวจโทเคน
- [x] หลังร้านสร้างโทเคนเมื่อเปิด “สมัครผ่าน QR”

---

## Deploy ที่ต้องระวัง

1. Deploy **functions** (`nposCompleteSale`, member CFs, `publicMemberSignup`) ก่อนหรือคู่กับ hosting  
2. Deploy **firestore rules + indexes**  
3. Hosting หลังร้าน (`/members`, `/join`)  
4. APK nPos **ไม่บังคับอัปเดตทันที** — อัปเมื่อพร้อมใช้สมาชิกที่เคาน์เตอร์  
5. เปิดระบบที่ หลังร้าน → สมาชิก / แต้ม → ตั้งค่า → **เปิดระบบสมาชิก**

## ข้อมูลหลัก

| Collection / doc | บทบาท |
|------------------|--------|
| `members/{phoneDigits}` | โปรไฟล์ + `pointsBalance` |
| `memberLedger/{id}` | ความจริงของแต้ม |
| `meta/memberSettings` | กฎร้าน · ธง QR |
