/**
 * รัน POS e2e ทั้งชุด + สรุปแผนงานที่รัน
 * Run: npm run test:pos-e2e-all
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const SUITES = [
  { name: "pos-nav-e2e", script: "scripts/test-pos-nav-e2e.mjs", phase: 1 },
  { name: "pos-menu-e2e", script: "scripts/test-pos-menu-e2e.mjs", phase: 1 },
  { name: "pos-sell-e2e", script: "scripts/test-pos-sell-e2e.mjs", phase: 1 },
  { name: "pos-session-chaos", script: "scripts/test-pos-session-chaos.mjs", phase: 3, unit: true },
  { name: "pos-session-reload-e2e", script: "scripts/test-pos-session-reload-e2e.mjs", phase: 3 },
  { name: "pos-multi-tap-e2e", script: "scripts/test-pos-multi-tap-e2e.mjs", phase: 3 },
  { name: "pos-offline-e2e", script: "scripts/test-pos-offline-e2e.mjs", phase: 3 },
  { name: "pos-stuck-bill-e2e", script: "scripts/test-pos-stuck-bill-e2e.mjs", phase: 3 },
];

/** Phase 3 e2e ล้มได้โดยไม่บล็อก deploy (ต้องการ Firebase + เมนู seed) */
const NON_BLOCKING = new Set(["pos-sell-e2e", "pos-session-reload-e2e", "pos-multi-tap-e2e", "pos-offline-e2e", "pos-stuck-bill-e2e"]);

const results = [];

function runNode(script) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

console.log("=== TellTea POS e2e — all suites ===\n");

for (const suite of SUITES) {
  console.log(`\n--- ${suite.name} (phase ${suite.phase}) ---\n`);
  const code = await runNode(suite.script);
  results.push({ ...suite, exitCode: code });
  if (code !== 0 && NON_BLOCKING.has(suite.name)) {
    console.warn(`WARN: ${suite.name} failed — ไม่บล็อกชุดอื่น`);
  }
}

const blockers = results.filter(
  (r) => r.exitCode !== 0 && !NON_BLOCKING.has(r.name),
);
const summary = {
  at: new Date().toISOString(),
  url: process.env.POS_E2E_URL || "https://telltea-pos.web.app/pos/",
  results,
  passed: blockers.length === 0,
};

try {
  writeFileSync("/tmp/pos-e2e-report.json", `${JSON.stringify(summary, null, 2)}\n`);
} catch {
  /* optional */
}

console.log("\n=== สรุป ===");
for (const r of results) {
  const tag = r.exitCode === 0 ? "PASS" : NON_BLOCKING.has(r.name) ? "WARN" : "FAIL";
  console.log(`  ${tag}  ${r.name}`);
}

if (blockers.length) {
  console.error(`\n${blockers.length} blocking suite(s) failed`);
  process.exit(1);
}
if (results.some((r) => r.exitCode !== 0)) {
  console.log("\nOK pos-e2e-all (with warnings)");
} else {
  console.log("\nOK pos-e2e-all");
}
