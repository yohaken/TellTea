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
];

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
}

const failed = results.filter((r) => r.exitCode !== 0);
const summary = {
  at: new Date().toISOString(),
  url: process.env.POS_E2E_URL || "https://telltea-pos.web.app/pos/",
  results,
  passed: failed.length === 0,
};

try {
  writeFileSync("/tmp/pos-e2e-report.json", `${JSON.stringify(summary, null, 2)}\n`);
} catch {
  /* optional */
}

console.log("\n=== สรุป ===");
for (const r of results) {
  console.log(`  ${r.exitCode === 0 ? "PASS" : "FAIL"}  ${r.name}`);
}

if (failed.length) {
  console.error(`\n${failed.length} suite(s) failed`);
  process.exit(1);
}
console.log("\nOK pos-e2e-all");
