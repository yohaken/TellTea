# Deploy version — ให้บิวด์ขึ้นเว็บจริง

## Agent ship gate (บังคับ)

**ห้าม commit / push / deploy จนกว่าผู้ใช้จะสั่งชัดในแชท**

| ได้โดยไม่ต้องรอ | ห้ามทำเอง |
|-----------------|-----------|
| แก้โค้ด · เทส · `npm run dev` local | `git commit` / `git push` / merge `main` |
| bump `APP_BUILD` / `POS_BUILD` เตรียมไว้ | `firebase deploy` หรือสั่งรัน CI deploy |
| บอกว่าพร้อม ship แล้วถามคำสั่ง | อ้างกฎ P-Note / โปรเจกต์อื่นว่าต้อง auto-ship |

คำสั่งที่ถือว่าชัด: เช่น “commit”, “push”, “deploy”, “ขึ้น production”, “ship”  
กฎ Cursor: `.cursor/rules/no-ship-until-ordered.mdc`

## ปัญหาที่เจอบ่อย

CDN ของ Firebase ตั้ง `no-cache` สำหรับ HTML / `version.json` แล้ว — **ไม่ใช่แคชโฮสติ้ง** เป็นตัวการหลัก  
ที่ทำให้ดูเหมือน “บิ้วไม่ขึ้น” ส่วนใหญ่คือ:

1. **แท็บเปิดค้าง** ยังรัน JS เก่า (SPA ไม่รีโหลดเองจนกว่าจะมีสัญญาณอัปเดต)
2. **ลืม bump `APP_BUILD`** → `/version.json` กับ bundle เป็นเลขเดียวกัน → ไม่มีแบนเนอร์อัปเดต
3. **CI เขียวแต่ไม่เคยเช็ค live** ว่า shop/POS version ตรง commit

## ระบบระยะยาวใน repo นี้

| ชั้น | กลไก |
|------|------|
| บังคับ bump | `npm run test:app-build-bump` ใน deploy — แก้ `src/app|components|lib…` แล้ว `APP_BUILD`/`POS_BUILD` ต้องโต |
| บังคับ live | `npm run smoke:live-version` หลัง hosting — รอ CDN แล้ว assert `telltea-shop` / `telltea-pos` ≥ build ในซอร์ส |
| ไคลเอนต์ | `AppUpdateWatcher` โพล `/version.json` ทุก 30s + โฟกัสแท็บ · idle ~90s รีโหลดเอง · snooze ได้ |
| บังคับทันที | Settings → `forceAppUpdate` (เจ้าของ) หลัง ship ใหญ่ |

## ตรวจมือหลัง deploy

```bash
curl -sS https://telltea-shop.web.app/version.json
# ต้องเห็น "build" ≥ APP_BUILD ใน src/lib/version.ts
```

ป้ายในแอปต้องตรงกันหลังรีโหลด — ถ้า `version.json` ใหม่แต่ป้ายเก่ = แท็บยังไม่รีโหลด

## Checklist ตอน ship UI

1. แก้โค้ดหน้าจอ/JS  
2. Bump `APP_BUILD` (และ `POS_BUILD` ถ้าแตะ POS)  
3. Push `main` → รอ Actions ถึงขั้น **Verify live shop + POS version.json** ผ่าน  
4. เปิดร้านแล้วดูป้ายเวอร์ชัน / หรือรอแบนเนอร์อัปเดต  
