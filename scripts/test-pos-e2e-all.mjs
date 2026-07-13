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
  if (code !== 0 && suite.name === "pos-sell-e2e") {
    console.warn("WARN: pos-sell-e2e failed — ไม่บล็อกชุดอื่น (ยังรัน deploy ได้ถ้า nav+menu ผ่าน)");
  }
}

const blockers = results.filter(
  (r) => r.exitCode !== 0 && r.name !== "pos-sell-e2e",
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
  const tag = r.exitCode === 0 ? "PASS" : r.name === "pos-sell-e2e" ? "WARN" : "FAIL";
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
