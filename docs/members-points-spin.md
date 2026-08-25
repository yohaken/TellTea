# เกมหมุนวงล้อลุ้นแต้ม Tell Tea

อัปเดต: 2026-08-25

## สถานะเปิดใช้ (สำคัญ)

| พื้นที่ | สถานะ |
|---------|--------|
| **หลังร้านจำลอง** `/members/spin-demo/` | ✅ ทดลอง + ตั้งค่า + สวิตช์เปิดเกม |
| **ลิงก์ลูกค้า** `/claim` · `/join` | ✅ ควบคุมด้วย `meta/pointsSpinSettings.gamesEnabled.spin` |

เปิด/ปิดรายเกมที่ `/members/spin-demo/` → ติ๊ก **เปิดเกม «หมุนวงล้อ»** → **บันทึกค่าตั้งวงล้อ**  
หน้าสมาชิก subscribe ค่าตั้งแบบ realtime — มีผลทันทีหลังบันทึก

---

เกมเดียว: **หมุนวงล้อ** ลุ้น**แต้มได้เพิ่ม** **0–5** (+0 = ไม่ได้แต้มเพิ่มจากเกม · เครดิตผ่าน Cloud Function)

### หลักการเล่น (สกิล)

- ผู้เล่นต้อง**กะจังหวะกดหยุดเอง** — ไม่ใช่สุ่มผลล่วงหน้าแล้วหมุนโชว์
- กดหยุดแล้ววงล้อ**หน่วงตามฟิสิกส์** ผล = ชิ้นใต้เข็มตอนหยุด
- **แต่ละรอบสุ่ม** จำนวนช่อง / ความเร็ว / ความหน่วง ภายในช่วงที่เจ้าของตั้ง — กันจับทาง
- สัดส่วนมุมรวมของแต้ม **0–5** ตั้งเอง (ไม่สุ่ม)
- ขนาดช่อง: **ตาม %** (ค่าเริ่ม) หรือช่องเท่ากัน

### ค่าตั้งที่บันทึกได้

เก็บที่ Firestore `meta/pointsSpinSettings` (อ่านสาธารณะ · เขียนเจ้าของ)

| ค่า | ความหมาย | ค่าเริ่ม |
|-----|----------|----------|
| `gamesEnabled.spin` | เปิดเกมบน /claim · /join | `false` |
| `sliceCountMin` / `Max` | ช่วงสุ่มจำนวนช่อง | **16–22** |
| `spinSpeedMin` / `Max` | ช่วงสุ่มความเร็ว (deg/s) | **160–200** |
| `stopDecelMin` / `Max` | ช่วงสุ่มความหน่วง (deg/s²) | **180–800** |
| `shuffleLayout` | สลับตำแหน่งชิ้นทุกครั้งที่เริ่มเล่น | `true` |
| `sliceSizing` | `byWeight` = ช่องกว้างตาม % · `equal` = เท่ากัน | `byWeight` |
| `weights` | สัดส่วนมุมรวมแต้ม 0–5 | 50/25/12/7/4/2 |
| `sliceCount` / `spinSpeed` / `stopDecel` | ค่า mid / รอบที่ resolve แล้ว (พรีวิว) | mid ของช่วง |

ตั้งที่: https://telltea-bo.web.app/members/spin-demo/ → **บันทึกค่าตั้งวงล้อ**

ตอนเริ่มเล่น (`PointsGameOnce`) เรียก `resolvePlaySettings` สุ่มครั้งเดียวแล้วล็อกจนจบรอบ

### เครดิตแต้ม + จับตาผิดปกติ

- CF `publicSpinGameCredit` — รับ 0–5 · เคลมใช้ Firebase Auth · สมัครใช้ `spinPlayToken` ครั้งเดียว
- ลูกค้า: ล็อกค่าตั้งวงตอนเล่น · ปุ่มบันทึกแต้มอีกครั้งเมื่อเน็ตหลุด · join โชว์เกมเมื่อมี playToken · claim resume ถ้าเคลมแล้วแต่ยังไม่ `spinGameCredited`
- ledger reason: `earn_spin_game`
- สมาชิกมีฟิลด์ `lifetimeGameBonusPoints` — ตาราง `/members` คอลัมน์ **แต้มเกม** (ไฮไลต์เมื่อ ≥ 20)

## อื่นๆ

- ไม่ใช่ของแถม/สินค้า · **ไม่ใช่ตัวคูณ** แต้มฐาน
- ชิ้นบนวงคละ — ไม่เรียงเลขติด (เช่น 3-4-5) และไม่รวมแผงค่าเดียวกันยาว
- โลโก้กลางวง = `meta/brandLogo`
- kill-switch ฝั่ง build: `POINTS_GAMES_KILL_SWITCH` (ปกติ `false`)

## เฟส

| เฟส | สถานะ |
|-----|--------|
| **S3e** | ✅ เกมเดียว · ฟิสิกส์ · แต้มคงที่ · ชิ้นกระจาย |
| **S3f** | ✅ จำนวนช่องตั้งได้ · ค่าตั้งบันทึกได้ · ช่องใหญ่พอให้กะ |
| **S4** | ✅ เซิร์ฟเวอร์เครดิตแต้ม + idempotent |
| **S5** | ✅ สวิตช์เปิดเกมใน Firestore · มีผลทันที |
| **S6** | ✅ สุ่มต่อรอบ (ช่วงช่อง/ความเร็ว/หน่วง) · สลับตำแหน่ง · ขนาดตาม % |

## ไฟล์หลัก

- `src/lib/points-spin-settings.ts` — โหลด/บันทึก/subscribe/`resolvePlaySettings`
- `src/lib/points-spin-credit.ts` — เรียก CF เครดิต
- `src/lib/points-multiplier-spin.ts` — สร้างชิ้น / มุม equal|byWeight / อ่านผลจากมุม
- `src/components/PointsMultiplierSpin.tsx` — UI + หน่วง
- `src/app/members/spin-demo/page.tsx` — หลังร้านจำลอง + ตั้งค่า + สวิตช์
- `functions/pos-members.js` — `creditSpinGamePoints` / `issueSpinPlayToken`
