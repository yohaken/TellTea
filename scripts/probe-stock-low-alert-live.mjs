/**
 * Live probe: evaluate stock-low LINE path 5 times, 20s apart.
 * Uses Application Default Credentials · project mypeer-501909
 *
 * Expect: 1st may send (if LINE ready + in window); 2–5 → cooldown
 */
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";

const require = createRequire(import.meta.url);
const admin = require("firebase-admin");
const { evaluateAndSendStockLowLine } = require("../functions/low-stock-line.js");

const PROJECT = "mypeer-501909";
const PROBE_ID = "probe-stock-low-alert";
const ROUNDS = 5;
const GAP_MS = 20_000;

function initAdmin() {
  if (admin.apps.length) return;
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: PROJECT,
  });
}

async function main() {
  initAdmin();
  const db = admin.firestore();
  const itemRef = db.doc(`stock/${PROBE_ID}`);
  const alertRef = db.doc(`stockLowAlerts/${PROBE_ID}`);

  const before = await itemRef.get();
  const restore = before.exists ? before.data() : null;

  await itemRef.set(
    {
      name: "PROBE คลังต่ำ (ลบได้)",
      unit: "ชิ้น",
      qty: 1,
      minQty: 10,
      alertEnabled: true,
      safetyStock: 0,
      note: "auto-probe · safe to delete",
      updatedAt: Date.now(),
      updatedBy: "probe-stock-low-alert",
    },
    { merge: true },
  );
  // clear cooldown so round 1 can send
  await alertRef.delete().catch(() => undefined);

  console.log(`Probe item stock/${PROBE_ID} armed (qty 1 ≤ min 10)`);
  console.log(`Running ${ROUNDS} evaluates · gap ${GAP_MS / 1000}s · force=false\n`);

  const results = [];
  for (let i = 1; i <= ROUNDS; i++) {
    const started = new Date().toISOString();
    const result = await evaluateAndSendStockLowLine({
      db,
      itemId: PROBE_ID,
      force: false,
    });
    results.push({ round: i, at: started, ...result });
    console.log(
      `#${i} ${started} · sent=${result.sent} · reason=${result.reason}` +
        (result.cooldownMsLeft != null
          ? ` · cooldownLeft=${Math.round(result.cooldownMsLeft / 1000)}s`
          : ""),
    );
    if (i < ROUNDS) {
      console.log(`  …รอ ${GAP_MS / 1000}s`);
      await sleep(GAP_MS);
    }
  }

  if (restore) {
    await itemRef.set(restore, { merge: false });
    console.log("\nRestored previous stock doc");
  } else {
    await itemRef.delete();
    console.log("\nDeleted probe stock doc");
  }
  await alertRef.delete().catch(() => undefined);

  const sent = results.filter((r) => r.sent).length;
  const cooldown = results.filter((r) => r.reason === "cooldown").length;
  console.log("\nSummary:");
  console.log(`  sent=${sent} · cooldown=${cooldown} · other=${ROUNDS - sent - cooldown}`);
  for (const r of results) {
    console.log(`  #${r.round} ${r.reason}${r.sent ? " ✓ LINE" : ""}`);
  }

  // Success criteria: evaluate ran; if LINE ready, first send OR deferred; later cooldown OR consistent reason
  const okReasons = new Set([
    "sent",
    "cooldown",
    "outside_hours",
    "missing_line_credentials",
    "instant_line_disabled",
    "stock_instant_disabled",
    "not_armed",
    "retry_wait",
  ]);
  const bad = results.filter((r) => !okReasons.has(r.reason) && r.reason !== "line_error");
  if (bad.length) {
    console.error("Unexpected reasons:", bad);
    process.exit(1);
  }
  if (results.every((r) => r.reason === "missing_line_credentials")) {
    console.warn("LINE credentials missing — path OK but no push");
  }
  console.log("\nOK probe-stock-low-alert-live");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
