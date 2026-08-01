# บันทึกศึกษาเมล VAT — สำหรับ AI / คนจูน

> อัปเดต: 2026-08-01  
> หน้าเว็บ: `/vat-sales/sources/` · บล็อก `#vat-mail-study-notes`  
> Firestore: `meta/vatMailStudyNotes`

---

## สิทธิ์เข้าถึง

| แหล่ง | AI cloud agent อ่านตรงๆ ได้ไหม |
|-------|--------------------------------|
| Gmail inbox จริง | ไม่ — ต้อง owner เชื่อม + ซิงก์ |
| `platformEmailReports` | ได้เมื่อมี SA / หรืออ่านจากบันทึกที่ owner อัปเดต |
| `#vat-mail-study-notes` บนหน้า | ได้เมื่อเปิดหน้าที่มา (DOM) |
| เอกสารนี้ใน repo | ได้เสมอ |

**วิธีทำงานร่วม:** owner ซิงก์เมล → กด「อัปเดตบันทึก AI」→ AI อ่านแคตตาล็อกจากบันทึก/หน้าเว็บ

**ถ้า AI เข้าหน้าเว็บไม่ได้ (ติด login):**  
- เจ้าของกด「API สำหรับ AI」→ สร้าง token →「คัดลอก curl ให้ AI」วางในแชท (แนะนำ)  
- หรือกด「คัดลอกบันทึก」แล้ววางในแชท  
- หรือ push branch `cursor/dump-vat-mail-notes-2f65` → workflow dump ใน Actions log  

**Agent Dump API:** `vatMailAgentDump` · token ใน `meta/vatAgentApi` (owner-only)  
ไม่ต้องส่ง Gmail Client Secret / refresh token ให้นักพัฒนา AI

---

## โมเดลแหล่งยอด (ที่ตกลงแล้ว)

| ช่องทาง | เมล/ไฟล์ | เข้าสู่ยอดเดลิเวอรี่ |
|---------|----------|---------------------|
| Grab | หลายฉบับรายวัน · ตัวเลขมักใน PDF/CSV แนบ | ม้วนรวม → ยอดเดือน |
| LINE MAN | รายงานสรุปเดือน PDF (+ อาจมีรายวัน) | อ่านยอดรวมเดือน |
| Shopee | สรุปเดือน Excel/รายงาน · ใบกำกับ GP คนละชุด | อ่านยอดรวมเดือน |

ยังไม่ลงงบรายวัน · จูนแท็กก่อน · ค่อยผสานเข้าตารางยอดเดลิเวอรี่

---

## แพทเทิร์นจาก fixture ใน repo (`testdata/vat-mail/`)

### Grab รายวัน
- From: `grab.com` / `noreply@grab.com`
- Subject: สรุปยอดขาย / Daily Sales / ประจำวันที่
- ฟิลด์: ยอดที่ลูกค้าจ่าย (gross) · ค่าคอม (fee) · ยอดโอนสุทธิ (net)
- บางฉบับตัวเลขอยู่เฉพาะใน PDF แนบ (`--- PDF ---` หลังซิงก์)
- **ข้าม:** Receipt/Tax Invoice (ไม่ใช่ยอดขายวัน)

### LINE MAN
- From: `lineman.line.me` / wongnai
- รายวัน: ยอดขายรวม · ค่าบริการ · ยอดโอน / รายรับ + E-Payment
- สรุปเดือน: รายงานประจำเดือน PDF (อะแดปเตอร์ `lineman-monthly-pdf`)

### Shopee
- Settlement / สรุปยอด · ยอดสั่งซื้อ · ค่าบริการ · ยอดที่ร้านจะได้รับ
- ใบกำกับ commission = VAT-ซื้อ คนละงานกับยอดขาย

---

## แท็กศึกษาบนตาราง

`grab-รายวัน` · `lm-สรุปเดือน` · `sf-สรุปเดือน` · `excel` · `pdf` · `csv` · `รอแกะ` · `ข้าม`

---

## คำสั่งสั้นสำหรับ AI รอบถัดไป

1. อ่าน `#vat-mail-study-notes` หรือ `meta/vatMailStudyNotes`
2. จัดกลุ่มตามช่องทาง + grain (daily/monthly) + ชนิดไฟล์
3. เสนอแมป → ยอดขายแอพ / ยอดโอน / คชจ.GP / VAT-ซื้อ ต่อเดือน
4. อย่าเขียนงบจนกว่า owner ยืนยัน
