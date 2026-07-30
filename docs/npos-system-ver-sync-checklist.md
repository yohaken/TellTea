# nPos — เวอร์ชันระบบในตารางเครื่องต้องตาม APK

อัปเดต: **1.14.87** · `versionCode` 110 · `APP_BUILD` 508

## ทำไมสำคัญ

คอลัมน์ **เวอร์ชันระบบ** ในตารางเครื่องหลังร้าน ใช้เทียบกับเวอร์ชันบนแท็บเล็ต  
ถ้า pin ค้างเวอร์ชันเก่า → เครื่องเก่าจะขึ้น ✓ / ไม่ขึ้นว่าต้องอัปเดต

- แอป nPos เองเช็ค `latest.json` แยก (ยังบังคับอัปเดตได้)
- แต่ตาราง BO จะโกหกถ้า `NPOS_SYSTEM_VERSION_*` ไม่ตาม `build.gradle`

## กติกา (เคร่ง)

ทุกครั้งที่ bump `npos-telltea/app/build.gradle` (`versionName` / `versionCode`)  
**ต้อง** bump คู่ใน `src/lib/npos-apk-release.ts`:

```ts
export const NPOS_SYSTEM_VERSION_NAME = "…";
export const NPOS_SYSTEM_VERSION_CODE = …;
```

## เกต

- `scripts/test-npos-system-ver-sync.mjs` — pin == gradle
- `scripts/publish-pos-apk.mjs` — ตายถ้า pin ไม่ตรง APK
- `firebase.json` `/downloads/**` — CORS ให้หลังร้านดึง `latest.json` ได้

```bash
node scripts/test-npos-system-ver-sync.mjs
```
