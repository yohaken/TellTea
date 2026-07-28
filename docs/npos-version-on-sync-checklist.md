# nPos — เช็คเวอร์ชันบนจังหวะซิงก์ / ชีพจรเซิร์ฟเวอร์

อัปเดต: **1.14.43** · `APP_BUILD` 301 · `POS_BUILD` 96 · vc **66**

## ปัญหา

- ชิป «BO Ns» = ชีพจรที่นั่งทุก ~5 วิ (kick/seat) — **ไม่ได้** เช็ค APK
- แท็บเล็ตเช็ค `latest.json` ตอน resume เท่านั้น · throttle **60s** → ค้างหน้าร้านแล้วช้า
- หลังร้านเว็บ poll `/version.json` ทุก **120s** · ไม่รีเช็คตอนโฟกัสแท็บ

## มติ

| ชั้น | พฤติกรรม |
|------|----------|
| Native (เคาน์เตอร์) | หลัง heartbeat สำเร็จ → เช็ค `latest.json` (throttle ร่วม ~30s) · ขึ้นป๊อบอัปเดตทันทีถ้าใหม่กว่า |
| BO web | poll ~30s + เช็คตอน `visibility` / `focus` |
| POS web | หลัง device heartbeat สำเร็จ → กระตุ้นเช็ค `/pos-version.json` (throttle ร่วม) |
| CF คืน version ใน heartbeat | นอกสcope รอบนี้ (ลดดีเลย์พอด้วย HTTP แยก + sync pulse) |

## V0 Native

- [x] `UpdateCheckCoordinator` — throttle ร่วม · bind ป๊อบที่โฟกัส
- [x] `ForegroundHeartbeat.onSuccess` → `onServerSyncPulse`
- [x] `AUTO_CHECK_MIN_INTERVAL_MS` = 30s
- [x] `UpdatePromptController.onPause` unbind

## V1 Web BO + POS

- [x] `AppUpdateWatcher` — poll 30s + visibility/focus
- [x] `pos-app-context` ยิง `telltea-pos-sync-pulse` หลัง heartbeat สำเร็จ
- [x] `PosUpdateWatcher` ฟัง pulse แล้วเช็คเวอร์ชัน

## ตรวจ

```bash
node scripts/test-npos-version-on-sync.mjs
```
