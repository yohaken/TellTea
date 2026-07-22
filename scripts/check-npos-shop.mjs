/**
 * Shop work-check harness — run unit gates + optional live capture smoke.
 *
 *   node scripts/check-npos-shop.mjs
 *   SKIP_CAPTURE_SMOKE=1 node scripts/check-npos-shop.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = "/opt/cursor/artifacts/npos-shop-check";
mkdirSync(outDir, { recursive: true });

const steps = [
  { name: "master-sell-phases", cmd: ["node", "scripts/test-npos-master-sell-phases.mjs"] },
  { name: "sell-layout", cmd: ["node", "scripts/test-npos-sell-layout.mjs"] },
  { name: "customer-display", cmd: ["node", "scripts/test-npos-customer-display.mjs"] },
  { name: "capture-wiring", cmd: ["node", "scripts/test-npos-capture.mjs"] },
  { name: "web-parity-shot", cmd: ["node", "scripts/test-npos-web-parity-shot.mjs"] },
  { name: "smart-ui-scale", cmd: ["node", "scripts/test-npos-smart-ui-scale.mjs"] },
  { name: "shop-phases-w", cmd: ["node", "scripts/test-npos-shop-phases.mjs"] },
  { name: "outbox-w4", cmd: ["node", "scripts/test-npos-outbox.mjs"] },
  { name: "void-w5", cmd: ["node", "scripts/test-npos-void-server.mjs"] },
  { name: "device-class-d1", cmd: ["node", "scripts/test-npos-device-class.mjs"] },
];

if (process.env.SKIP_CAPTURE_SMOKE !== "1") {
  steps.push({ name: "capture-smoke-live", cmd: ["node", "scripts/smoke-npos-capture-image.mjs"] });
}

const results = [];
let failed = 0;
for (const step of steps) {
  const started = Date.now();
  const r = spawnSync(step.cmd[0], step.cmd.slice(1), {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  const ok = r.status === 0;
  if (!ok) failed += 1;
  const entry = {
    name: step.name,
    ok,
    ms: Date.now() - started,
    status: r.status,
    stdout: (r.stdout || "").trim().split("\n").slice(-3).join("\n"),
    stderr: (r.stderr || "").trim().slice(0, 400),
  };
  results.push(entry);
  console.log(`${ok ? "OK" : "FAIL"} ${step.name} (${entry.ms}ms)`);
  if (!ok && entry.stderr) console.log(entry.stderr);
  if (!ok && entry.stdout) console.log(entry.stdout);
}

const report = {
  at: new Date().toISOString(),
  failed,
  skipCaptureSmoke: process.env.SKIP_CAPTURE_SMOKE === "1",
  results,
};
writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));

if (failed) {
  console.error(`FAIL check-npos-shop — ${failed} step(s)`);
  process.exit(1);
}
console.log("OK check-npos-shop");
