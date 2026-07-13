/**
 * POS sync utility tests (mirrors src/lib/pos-sync-utils.ts).
 */
import assert from "node:assert/strict";

function isRetryableSaleError(err) {
  const code = err?.code || "";
  const message = err?.message || "";
  if (code === "functions/invalid-argument" || code === "functions/permission-denied") {
    return false;
  }
  if (code === "functions/unavailable" || code === "functions/deadline-exceeded") {
    return true;
  }
  if (code === "functions/internal") return true;
  if (/network|fetch|failed to fetch|offline|unavailable/i.test(message)) return true;
  return false;
}

function formatPendingBillNo(clientMutationId) {
  const short = clientMutationId.replace(/[^a-zA-Z0-9]/g, "").slice(-6).toUpperCase();
  return `รอส่ง-${short || "LOCAL"}`;
}

assert.equal(isRetryableSaleError({ code: "functions/unavailable" }), true);
assert.equal(isRetryableSaleError({ code: "functions/invalid-argument" }), false);
assert.equal(isRetryableSaleError({ message: "Failed to fetch" }), true);
assert.equal(isRetryableSaleError({ code: "functions/internal" }), true);

const label = formatPendingBillNo("device-abc-xyz-123456");
assert.match(label, /^รอส่ง-[A-Z0-9]+$/);

const cfSrc = await import("node:fs").then((fs) =>
  fs.readFileSync(new URL("../functions/pos-complete-sale.js", import.meta.url), "utf8"),
);
assert.match(cfSrc, /posSaleMutations/);
assert.match(cfSrc, /clientMutationId/);

const outboxSrc = await import("node:fs").then((fs) =>
  fs.readFileSync(new URL("../src/lib/pos-outbox.ts", import.meta.url), "utf8"),
);
assert.match(outboxSrc, /telltea-pos-sync/);

const salesSrc = await import("node:fs").then((fs) =>
  fs.readFileSync(new URL("../src/lib/pos-sales.ts", import.meta.url), "utf8"),
);
assert.match(salesSrc, /enqueueSale/);
assert.match(salesSrc, /isBrowserOnline/);

const syncSrc = await import("node:fs").then((fs) =>
  fs.readFileSync(new URL("../src/lib/pos-sync.ts", import.meta.url), "utf8"),
);
assert.match(syncSrc, /syncing: boolean/);
assert.match(syncSrc, /syncing: true/);

const watcherSrc = await import("node:fs").then((fs) =>
  fs.readFileSync(new URL("../src/components/PosSyncWatcher.tsx", import.meta.url), "utf8"),
);
assert.match(watcherSrc, /onSyncChange/);
assert.match(watcherSrc, /pendingCount > 0/);

console.log("OK pos-sync");
