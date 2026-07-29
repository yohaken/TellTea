# คชจ. · VAT ซื้อ + ผู้จ่าย — เฟส + เช็คลิสต์

> เป้า: แยกภาษีซื้อ (ขอคืนได้) จากยอดจ่าย · รู้ผู้จ่าย/ชื่อบนใบกำกับ  
> UI กล่อง **หุบเป็นค่าเริ่มต้น** (`<details>`)  
> อัปเดต: 2026-07-29 · build 394

---

## ภาพรวมเฟส

| เฟส | ชื่อ | เป้า | สถานะ |
|-----|------|------|--------|
| **E0** | สเปก + กล่องหุบ | ชนิดข้อมูล · ป้ายภาษาบ้านๆ · UI fold หุบอย่างเดียว | ✅ |
| **E1** | แจ้งบิล + บช.เจ้าของ | ฟิลด์ต่อแถว · ฟอร์มในกล่องหุบ · รับบิลส่งต่อฟิลด์ | ✅ โค้ดฐาน |
| **E2** | คอลัมน์ตารางบาง | ชิปสั้น VAT/ผู้จ่าย ในแถว (ไม่ยืดสูง) | ✅ |
| **E3** | บช.พนักงาน (`ledger`) | ฟิลด์เดียวกันบนคชจ. ออก | ✅ โค้ดฐาน |
| **E4** | ลิงก์ภาษีซื้อ | สร้าง/ผูก `vatInputInvoices` จากแถวที่มี VAT | ✅ โค้ดฐาน |
| **E5** | AI อ่านใบกำกับ | ดึง VAT · ผู้ขาย · ชื่อผู้ซื้อจากรูป | ✅ โค้ดฐาน |

**ไม่อยู่ในสโคป:** ค่าธรรมเนียมโอนในตารางเทียบเงินนำเข้า (คนละเรื่อง)

---

## E0 — สเปกฟิลด์ (ต่อแถว)

| ฟิลด์ | ค่า | หมายเหตุ |
|------|-----|----------|
| `vatMode` | `unknown` / `none` / `inclusive` | ไม่แน่ใจ · ไม่มี VAT · ยอดรวมมี VAT |
| `vatBase` / `vatInput` | number | ฐานภาษี · VAT ซื้อ |
| `taxInvoiceNo` | string | เลขที่ใบกำกับ |
| `vendor` | string | ผู้ขาย / ร้าน |
| `payer` | `shop` / `owner` / `staff` / `other` / `""` | ผู้จ่าย |
| `invoiceName` | string | ใบกำกับออกในนาม |
| `invoiceNameOk` | `unknown` / `ok` / `mismatch` / `no_invoice` | ใช้ขอคืนได้ไหม |
| `vatInputInvoiceId` | string | ลิงก์ `vatInputInvoices` |

### เช็ค E0

- [x] ชนิดใน `src/lib/expense-vat.ts`
- [x] กล่องฟอร์มหุบอย่างเดียว (`ExpenseVatPayerFold`)
- [ ] เจ้าของยืนยันป้ายภาษาใช้จริง

---

## E1 — แจ้งบิล + บช.เจ้าของ

- [x] เก็บฟิลด์บน `billNotices` + `ownerBooks`
- [x] ฟอร์มกล่องหุบ
- [x] `acceptBillNotice` คัดลอก + sync ภาษีซื้อ
- [x] สรุปแจ้งบิลหุบเป็นค่าเริ่มต้น
- [ ] ใช้จริงที่ร้าน

---

## E2 — คอลัมน์/ชิปในตาราง

- [x] ชิปสั้นแจ้งบิล + บช.เจ้าของ + ledger
- [x] tooltip สรุป
- [x] nowrap
- [ ] มือถือไม่เบียดเกินไป

---

## E3 — ledger พนักงาน

- [x] ฟิลด์บนรายการ `amountOut`
- [x] ฟอร์มในกล่องหุบ (เพิ่ม/แก้เงินออก)
- [x] ไม่บังคับกรอก VAT
- [ ] ใช้จริง

---

## E4 — ลิงก์ `vatInputInvoices`

เงื่อนไข sync: `vatMode=inclusive` + `invoiceNameOk=ok` + `vatInput>0` · **เจ้าของเท่านั้น**

- [x] `src/lib/expense-vat-sync.ts`
- [x] รับบิล / บช.เจ้าของ / ledger (owner) เรียก sync
- [x] เก็บ `vatInputInvoiceId` บนแถว
- [ ] รวมยอดภาษีซื้อรายเดือนจากแถวจริง (เสริม play-safe) — รอบถัดไป

---

## E5 — AI

- [x] extract: vatMode · vatInput · vatBase · taxInvoiceNo · vendor · invoiceName · invoiceNameOk
- [x] `mergeExtractIntoExpenseVat` ไม่ทับค่าที่กรอกแล้ว
- [ ] ตรวจกับใบกำกับจริง 1–2 ใบ

---

## ป้ายภาษาบ้านๆ

| โค้ด | แสดง |
|------|------|
| vatMode unknown | ไม่แน่ใจ |
| vatMode none | ไม่มี VAT |
| vatMode inclusive | มี VAT ในยอด |
| payer shop | ร้านจ่าย |
| payer owner | เจ้าของจ่าย |
| payer staff | พนักงานจ่าย |
| invoiceNameOk ok | ใช้ขอคืนได้ |
| invoiceNameOk mismatch | ชื่อไม่ตรง |
| invoiceNameOk no_invoice | ไม่มีใบกำกับ |
