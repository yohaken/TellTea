/**
 * Session chaos / kick-out regression — mirrors applyRemotePosSessionUpdate.
 * Run: npm run test:pos-session-chaos
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function mapSession(id, data) {
  return {
    id,
    deviceId: typeof data.deviceId === "string" ? data.deviceId : "",
    date: typeof data.date === "number" ? data.date : 0,
    shift: typeof data.shift === "string" ? data.shift : "",
    openedAt: typeof data.openedAt === "number" ? data.openedAt : 0,
    closedAt: typeof data.closedAt === "number" ? data.closedAt : undefined,
    status: data.status === "closed" ? "closed" : "open",
    saleCount: typeof data.saleCount === "number" ? data.saleCount : 0,
    totalSales: typeof data.totalSales === "number" ? data.totalSales : 0,
  };
}

/** Mirror src/lib/pos-session.ts — without localStorage side effects */
function applyRemotePosSessionUpdate(deviceId, local, remote) {
  if (!remote) {
    return local?.status === "open" && local.deviceId === deviceId ? local : null;
  }
  if (remote.deviceId !== deviceId) return local;
  if (remote.status === "closed") return remote;
  return remote;
}

const deviceId = "dev-chaos-1";
const now = Date.now();

const localOpen = mapSession(`${deviceId}_${now}`, {
  deviceId,
  date: now,
  shift: "morning",
  openedAt: now,
  status: "open",
  saleCount: 2,
  totalSales: 150,
});

// Firestore doc ยังไม่ขึ้น — ต้องไม่ดีดออก
assert.equal(applyRemotePosSessionUpdate(deviceId, localOpen, null)?.status, "open");
assert.equal(applyRemotePosSessionUpdate(deviceId, localOpen, null)?.saleCount, 2);

// ไม่มี local + remote null → ไม่มี session
assert.equal(applyRemotePosSessionUpdate(deviceId, null, null), null);

// remote ปิดชัดเจน → ออกงาน
const remoteClosed = mapSession(localOpen.id, {
  ...localOpen,
  status: "closed",
  closedAt: now + 3600_000,
});
assert.equal(applyRemotePosSessionUpdate(deviceId, localOpen, remoteClosed)?.status, "closed");

// remote open จากเซิร์ฟเวอร์ → ใช้ remote
const remoteOpen = mapSession(localOpen.id, {
  ...localOpen,
  saleCount: 5,
  totalSales: 420,
});
assert.equal(applyRemotePosSessionUpdate(deviceId, localOpen, remoteOpen)?.saleCount, 5);

// device คนละเครื่อง → คง local
const otherDevice = mapSession("other_123", {
  deviceId: "other-device",
  status: "open",
  openedAt: now,
});
assert.equal(applyRemotePosSessionUpdate(deviceId, localOpen, otherDevice)?.status, "open");

// boot อ่าน local ก่อน reconcile — wiring ใน pos-app-context
const ctxSrc = readFileSync(join(root, "src/lib/pos-app-context.tsx"), "utf8");
assert.match(ctxSrc, /readLocalOpenPosSession\(authUid\)/);
assert.match(ctxSrc, /applyRemotePosSessionUpdate/);
assert.match(ctxSrc, /persistOpenPosSession\(local\)/);

// fetchRemote ไม่ล้าง stored id เมื่อ doc ยังไม่มี
const sessionSrc = readFileSync(join(root, "src/lib/pos-session.ts"), "utf8");
assert.doesNotMatch(
  sessionSrc,
  /if \(!stored\) \{\s*clearStoredPosSessionId/s,
);
assert.match(sessionSrc, /if \(stored && stored\.status !== "open"\)/);

console.log("OK pos-session-chaos");
