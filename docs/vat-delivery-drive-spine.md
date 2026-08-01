# โครงใหม่ — ไฟล์เมล → Google Drive → AI

> อัปเดต: 2026-08-01 · **แทนแนว parse ม้วนงบที่หลวม (D3–D5)**  
> หลัก: เก็บไฟล์จริงแยกแอพบน Drive · ให้ AI ทำงานกับไฟล์ ไม่เดาจากหัวข้อเมล

---

## ทำไมเปลี่ยน

ระบบเดิม (แท็ก → ข้อเสนอเดือน → parse ตัวเลขจากข้อความ) หลวมและพังง่าย:
- ยอดโอน/PDF หาย · mismatch · UI ซ้อน
- AI ไม่มีไฟล์จริงถือ

แนวใหม่สั้นและแข็งกว่า:

```
Gmail (แนบ PDF / Excel / CSV)
    ↓ API ซิงก์
Google Drive  แยกโฟลเดอร์ตามแอพ + เดือน
    ↓
AI อ่านไฟล์ (Dump ลิงก์ / เปิด Drive) → เสนอยอด
    ↓ owner ยืนยัน
ตารางยอดเดลิเวอรี่ (งบเดือน)
```

---

## โฟลเดอร์ Drive (ล็อก)

```
TellTea-VAT/
  grab/
    2026-07/
      <ไฟล์จากเมล>
    2026-08/
  lineman/
    2026-07/
  shopee/
    2026-07/
```

- ราก: `TellTea-VAT` (สร้างครั้งแรกเมื่อซิงก์ Drive)
- ชั้นแอพ: `grab` | `lineman` | `shopee`
- ชั้นเดือน: `YYYY-MM` จากวันที่รายงานในหัวข้อ ถ้าไม่มีใช้วันรับเมล (Bangkok)

---

## สิทธิ์ OAuth

| Scope | ใช้ทำ |
|-------|--------|
| `gmail.readonly` | อ่านเมล + ดาวน์โหลดแนบ |
| `drive.file` | สร้าง/เขียนเฉพาะไฟล์ที่แอพสร้าง (ไม่เห็น Drive ทั้งก้อน) |

**ต้องเชื่อม Gmail ใหม่ครั้งหนึ่ง** หลังอัป scope

Token ยังอยู่ `meta/vatMailOAuth` · รากโฟลเดอร์ `meta/vatMailDrive.rootFolderId`

---

## ชั้นข้อมูล

| ชั้น | ที่เก็บ | บทบาท |
|------|---------|--------|
| วัตถุดิบ | Gmail แนบ | ของจริง |
| คลังไฟล์ | Google Drive ตามแอพ/เดือน | คน+AI เปิดดู/ดาวน์โหลดง่าย |
| ดัชนี | `platformEmailReports` (+ `driveFiles[]`) | ชี้ว่าเมลไหนวางไฟล์ไหน |
| งบ | `vatMonthlyReturns` | ใส่หลัง AI+owner ยืนยันเท่านั้น |

Firebase Storage `vat-mail-pdfs/` ยังใช้เป็น cache ถอดข้อความได้ — **ไม่ใช่ที่หลักให้คน/AI แล้ว**

---

## เฟส (โครงใหม่)

| เฟส | งาน | สถานะ |
|-----|------|--------|
| **F0** | OAuth + scope Drive · สร้างรากโฟลเดอร์ | 🔄 (โค้ดพร้อม · owner เชื่อมใหม่ + ซิงก์ครั้งแรก) |
| **F1** | ซิงก์แนบทุกแอพ → Drive แยกเดือน | 🔄 (`vatMailDriveSync` · PDF/Excel/CSV) |
| **F2** | UI รายการไฟล์บน Drive + เปิดลิงก์ | ✅ `#vat-sources-drive-slot` |
| **F3** | Agent Dump ส่งรายการไฟล์/ลิงก์ให้ AI | ✅ `driveFiles[]` ใน `vatMailAgentDump` |
| **F4** | AI อ่านไฟล์ → ร่างยอดเดือน (ไม่เขียนงบเอง) | ⬜ |
| **F5** | Owner ยืนยัน → ลงตารางยอดเดลิเวอรี่ | ⬜ |

**หน้า `/vat-sales/sources/` (build 592):**  
1. ตาราง「ยอดรวมเดือน (ผสานเข้างบทันที)」  
2. บล็อก `#vat-sources-drive-slot` — เช็คลิสต์ F0–F5 · ปุ่มเชื่อม/ซิงก์เมล/ซิงก์ Drive · กล่องไฟล์แยกแอพ

เฟส D3–D5 แบบ parse ม้วนอัตโนมัติ — **พัก** (เก็บโค้ดไว้ ไม่เป็นทางหลัก)

---

## สิ่งที่ owner ทำ

1. ตัดเชื่อม Gmail แล้วเชื่อมใหม่ (รับสิทธิ์ Drive)  
2. กด **ซิงก์ไฟล์ → Drive**  
3. เปิดโฟลเดอร์ TellTea-VAT ตรวจว่าไฟล์แยกแอพ/เดือน  
4. ให้ AI อ่านรายการไฟล์จาก Dump / ลิงก์ Drive

---

## อ้างอิงโค้ด

- Drive helper / sync: `functions/vat-mail-drive.js` · callable `vatMailDriveSync`  
- แนบ: `functions/vat-mail-pdf.js` · `listDriveableParts` (pdf/xlsx/xls/csv)  
- OAuth scopes: `functions/vat-mail.js` · `OAUTH_SCOPES` = gmail.readonly + drive.file  
- Agent Dump: `functions/vat-mail-agent-dump.js` · `driveFiles[]`  
- Client: `src/lib/vat-sales-mail.ts` · `syncVatMailDrive` · `listMonthDriveFiles`  
- UI: `src/components/vat-sales/VatSourcesDriveSlot.tsx` · `#vat-sources-drive-slot`
