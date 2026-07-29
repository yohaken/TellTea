# VAT รายเดือน (Play-Safe) — สรุปวิเคราะห์ + สเปกใหม่

> แทนที่แนวคิด dailySales + เมลรายวัน  
> Route เดิม: `/vat-sales/` · owner-only  
> วันที่: 2026-07-28  
> **เฟส:** [`vat-phases-next.md`](./vat-phases-next.md) (M0–M5)  
> **เช็ค:** [`vat-monthly-check.md`](./vat-monthly-check.md)  
> **ตาราง 3 ก้อน:** [`vat-table-structure.md`](./vat-table-structure.md)

---

## 1) สรุปวิเคราะห์: ทำไมต้องยกโครงสร้างเดิม

| ของเดิม (P1–P7) | ปัญหาที่เจอ |
|-----------------|------------|
| กรอก/ซิงก์ยอดรายวันทุกช่องทาง | งานหนัก · คีย์ผิดง่าย · ไม่ตรงกับวิธีคิดภาษีจริงของร้าน |
| เมล Gmail/Outlook → parse → ยืนยันวัน | ความซับซ้อนสูง · parser ไม่นิ่ง · ไม่ใช่จุดที่ต้องยื่นรายวัน |
| ปิดเดือน = รวมวันที่ยืนยัน | ถ้าวันไหนขาด = รายได้ไม่ครบ = เสี่ยงเบี้ยปรับฝั่งรายได้ |
| ภาษีซื้อแยกใบกำกับทีละใบ | ดีสำหรับ audit แต่ช้า — ร้านใช้บิล GP สรุปเดือน + บิลวัตถุดิบ |

**ข้อสรุป:** ระบบเดิมออกแบบมาเพื่อ “คุมรายวัน” แต่ธุรกิจต้องการ “ยื่นรายเดือนแบบปลอดภัยและเร็ว”  
→ **ยกโครงสร้าง UI/โมเดลรายวันออกจากทางใช้งานหลัก** · ใช้ยอดรวมสิ้นเดือนแทน

---

## 2) รอบตัดยอด (ต้องชัด — กันสับสน)

- โซนเวลาภายในระบบ: Asia/Bangkok (ไม่แสดงข้อความนี้ใน UI)  
- เริ่มรอบ: **00:00 น.** ของวันที่เริ่ม (default = วันที่ **1** ของเดือน)  
- จบรอบ: ก่อน **00:00 น.** ของวันเริ่มรอบถัดไป (ไม่รวม)

ตัวอย่างเดือน ก.ค. 2569 (monthKey `2026-07`, startDay = 1):

```
00:00 น. 1/7/2569  →  23:59 น. 31/7/2569
```

ยอดที่ใส่ในเดือนนี้ = ยอดขายในช่วงเวลานี้เท่านั้น

---

## 3) แนวคิดใหม่ (หนึ่งภาพ)

```
[ ยอดขายรวมทั้งเดือน ]  ──แยก──►  Delivery | หน้าร้าน
               │
               ▼
   [ ภาษีขาย Output ]  = ยอดนำส่งจริง × เรทขาย%/(100+เรท%)   (default 7% ≡ 7/107)
   หน้าร้าน: รายได้ × นำส่ง% (default 90%) = นำส่งจริง → คิด VAT
               │
               ▼
   [ ภาษีซื้อ Input ]  = บิล GP (ระบุ % ของภาษีขาย เช่น 33.33%) + บิลวัตถุดิบ
                         · ปัดลง / claim factor < 1 (play-safe)
               │
               ▼
   [ ภาษีสุทธิ ] = Output − Input  → นำส่งสรรพากร
```

### Play-Safe Strategy

1. **รายได้:** ยื่นตามยอดขายรวมจริง 100% — ห้ามขาด  
2. **ค่าใช้จ่าย (ภาษีซื้อ):** ดึงจากบิล GP สรุปเดือน + บิลวัตถุดิบ · ยื่นหย่อน/ปัดลงเล็กน้อย  
3. **ผลลัพธ์:** อาจจ่ายเกินหลักสิบบาท แต่ปลอดภัย + ประหยัดเวลา · ลดความเสี่ยงถูกเรียกตรวจจากยอดรายได้ไม่ครบ

---

## 4) โครงสร้างหน้าใหม่

**หน้าเดียว** (ไม่มีแท็บเดือน/ปิด): ภาษีขาย → GP ช่องทาง → ภาษีซื้อ → แถบสุทธิ → บช. → ภ.ง.ด. → ปุ่มบันทึก/ปิดงบ

- เดลิเวอรี่ `+` → ShopeeFood / Grab / LINE MAN  
- หน้าร้าน `+` → เงินโอน / เงินสด  
- เรทเก็บต่อเดือน (คนละเดือนต่างกันได้) · `filed` = ล็อกแก้  
- ดูโครงตาราง: [`vat-table-structure.md`](./vat-table-structure.md)

---

## 5) Firestore (ใหม่)

```
vatMonthlyReturns/{YYYY-MM}
  delivery {
    channels { shopee, grab, lineman }, grossManual, grossSales,
    gpVat, useGpEstimate, ingredientVat, rates, …computed
  }
  storefront {
    tenders { transfer, cash }, grossManual, grossSales, …
  }
  totals { grossSales, vatBase, outputVat, inputVat, netVat }
  status: draft|saved|filed   // filed = ล็อกแก้
  pnlIncome, pnlIncomeMode, note, filedAt/By, updatedAt/By

meta/vatMonthlySettings
  deliveryRates, storefrontRates, pnlIncomeMode, periodStartDay
```

- Owner-only ทุกอัน  
- Collection เดิม (`dailySales`, mail, …) คง rules ไว้แต่ไม่ใช้ใน UI หลัก

---

## 6) สูตร (จุดเดียว)

```
outputVat = round(gross × outputNum / outputDen)   // default 7/107
vatBase   = gross − outputVat
gpEstimate = floor(outputVat × gpOfOutput)         // สำรองหน้าร้านเท่านั้น
// เดลิเวอรี่: gpRaw = Σ ภาษีซื้อ GP จากยอดโอนจริงรายช่องทาง (ไม่ใช้ประมาณก้อน)
gpClaimed  = floor(gpRaw × inputClaimFactor)       // default 98%
ingredientClaimed = floor(ingredientVat × inputClaimFactor)
inputVat = gpClaimed + ingredientClaimed
netVat   = outputVat − inputVat
```

ดูตารางช่องทาง: [`pnl-gp-by-channel.md`](./pnl-gp-by-channel.md)

---

## 7) UI compact slim (วิเคราะห์สั้น)

| ปัญหาเดิม | แก้ |
|-----------|-----|
| การ์ดส่ง/ร้านแนวตั้ง + ตารางผลซ้อน | ตารางเดียว 2 แถว + แถวรวม |
| คำว่า ~1/3 คลุมเครือ | แสดง/แก้เป็น **GP %** ชัดเจน |
| ย่อหัวคอลัมน์เกิน / ตัดข้อความ | หัวเต็ม อ่านได้ · `nowrap` แถวเดียว · เลื่อนแนวนอนเมื่อแคบ |
| แบนเนอร์รอบหลายบรรทัด | บรรทัดเดียวกระชับ |

---

## 8) สิ่งที่ยกทิ้งจากทางใช้งานหลัก

- ตารางรายวัน / สถานะวัน / confirm รายวัน  
- แท็บเมล · เทียบยอด · parser health เป็น workflow หลัก  
- การบังคับยืนยันครบทุกวันก่อนปิดเดือน  

(โค้ด/Functions เก่ายังอยู่ใน repo ได้ — ไม่ผูก UI หลักแล้ว)
