# Staff RBAC phases — พนักงาน vs เจ้าของ

Checklist สิทธิ์หลังร้าน (TellTea). เป้าหมาย: พนักงานเห็นงานหน้าร้านที่จำเป็น ไม่เห็นข้อมูลเจ้าของ/เงินเดือนคนอื่น

## Phase 0 — โมเดลสิทธิ์ ✅

- [x] เพิ่ม `payrollPay` แยกจาก `ownerBooks`
- [x] `ELEVATED_PERMISSION_KEYS` + `clampPermissionsForNonOwner`
- [x] กลุ่มสิทธิ์ในศูนย์พนักงาน

## Phase 1 — เงินเดือน / คิวจ่าย ✅

- [x] collection `employeePay/{empId}` + migrate จาก field บน `employees`
- [x] client: roster ไม่ expose pay; `listEmployeesWithPay` สำหรับเจ้าของ/คนจ่าย
- [x] `payrollItems` อ่านทั้งร้านเฉพาะ owner/`payrollPay`; พนักงาน query กรอง `employeeId`
- [x] หน้าโบนัส: staff โหลดคิว/เงินเดือนของตัวเอง

## Phase 2 — บัญชีร้าน mutate ✅

- [x] rules: update/delete ledger จำกัด createdBy + ห้ามแตะ amountIn (ยกเว้นเจ้าของ)
- [x] UI: แก้/เพิ่มรูปเฉพาะรายการที่ mutate ได้

## Phase 3 — Storage / หลักฐาน ✅

- [x] `owner-books/`, `vat-imports/` → owner / ownerBooks
- [x] `evidencePhotos` folder-scoped read/create
- [x] Cloud Function evidence upload ตรวจโฟลเดอร์ owner-books

## Phase 4 — staffManage escalate ✅

- [x] rules: สร้าง/แก้ staff ห้าม role owner + ห้ามมอบ elevated perms (ถ้าไม่ใช่เจ้าของ)
- [x] ห้ามแก้บัญชีตัวเองผ่าน hub / ห้ามลบ owner
- [x] UI PermissionPicker `hideElevated`

## Phase 5 — payrollPay แยกจาก ownerBooks ✅

- [x] `canPay` / `shopPayView` ใช้ `payrollPay`

## Phase 6 — ต้นทุนสต็อก ✅ (บางส่วน)

- [x] rules: staff update ห้ามเปลี่ยน `unitCost` / ชื่อ
- [x] client redact unitCost สำหรับ non-owner
- [ ] (ค้าง) ย้าย `unitCost` ออกจาก stock doc จริงๆ

## Phase 7 — OT / ผลิตขอบเขต ⏳

- [ ] staff อ่าน OT/ผลิตเน้นของตัวเอง (ตอนนี้ยังเห็นทั้งเดือนเพื่อคำนวณโบนัส)

## Phase 8 — ส่งออก / P&L ✅

- [x] export ติ๊กบช.เจ้าของ/P&L ได้เฉพาะเมื่อมีสิทธิ์จริง

## Phase 9 — ทำความสะอาด ⏳

- [ ] ทบทวน `assignTasks` / hardcode owner email
- [x] เอกสาร matrix นี้
- [ ] emulator rules tests ครบทุกเคส
