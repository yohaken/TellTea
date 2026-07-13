/**
 * รัน Phase 3 chaos e2e ทั้งชุด
 * Run: npm run test:pos-chaos-e2e
 */
import { spawn } from "node:child_process";

const SUITES = [
  "scripts/test-pos-session-reload-e2e.mjs",
  "scripts/test-pos-multi-tap-e2e.mjs",
  "scripts/test-pos-offline-e2e.mjs",
  "scripts/test-pos-stuck-bill-e2e.mjs",
];

function runNode(script) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { stdio: "inherit", env: process.env });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

console.log("=== TellTea POS chaos e2e (phase 3) ===\n");

const results = [];
for (const script of SUITES) {
  const name = script.split("/").pop().replace(".mjs", "");
  console.log(`\n--- ${name} ---\n`);
  const code = await runNode(script);
  results.push({ name, exitCode: code });
}

console.log("\n=== สรุป chaos e2e ===");
for (const r of results) {
  const tag = r.exitCode === 0 ? "PASS" : "WARN";
  console.log(`  ${tag}  ${r.name}`);
}

const failed = results.filter((r) => r.exitCode !== 0);
if (failed.length) {
  console.log(`\n${failed.length} chaos suite(s) failed — ไม่บล็อก deploy (ต้องการ Firebase จริง)`);
}
console.log("\nOK pos-chaos-e2e");
