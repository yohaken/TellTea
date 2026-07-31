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

## Phase 6 — ต้นทุนสต็อก ✅

- [x] rules: staff update ห้ามเปลี่ยนชื่อ
- [x] collection `stockCosts/{itemId}` — เจ้าของเท่านั้น
- [x] migrate unitCost ออกจาก stock + catalog เขียนผ่าน stockCosts

## Phase 7 — OT / ผลิตขอบเขต ✅

- [x] rules: staff อ่านได้เฉพาะ entry ที่อยู่ใน `workerIds` (หรือ createdBy)
- [x] client subscribe กรอง `workerId` บน OT / ผลิต / โบนัส
- [x] `bonusLivePool/{month}` — พนักงานได้ส่วนแบ่งขายโดยไม่อ่าน OT ทั้งร้าน

## Phase 8 — ส่งออก / P&L ✅

- [x] export ติ๊กบช.เจ้าของ/P&L ได้เฉพาะเมื่อมีสิทธิ์จริง

## Phase 9 — ทำความสะอาด ✅

- [x] `assignTasks` เอาออกจากกลุ่มสิทธิ์ UI · collection legacy ห้ามเขียน
- [x] แท็บงานยัง `signedIn` → `/tasks/` (weekly tasks จริง)
- [x] `isOwnerEmail` hardcode คงไว้คู่ `role==owner` (bootstrap / VAT mentor) — เอกสารนี้
- [x] static rules guards: `test:firestore-rules` + `test:staff-rbac` (ไม่มี emulator ใน repo)

## หลัง deploy

เข้าสู่ระบบด้วยบัญชี**เจ้าของ** หนึ่งครั้ง เพื่อ migrate:
- `employees` pay fields → `employeePay`
- `stock.unitCost` → `stockCosts`
