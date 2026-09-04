#!/usr/bin/env node
/**
 * Full Grab round: optional scan → apply → rescan → push tracker sheets.
 *
 * Batch-update auto-picks 4 tabs when remaining >30% (override with --workers=N).
 *
 *   node scripts/grab-price-run.mjs --apply
 *   node scripts/grab-price-run.mjs --apply --workers=4 --skip-scan --limit=5
 *   node scripts/grab-price-run.mjs --dry-run
 */
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, "..");

function run(cmd) {
  console.log(`\n$ ${cmd}\n`);
  execSync(cmd, { stdio: "inherit", cwd: root });
}

async function main() {
  const apply = process.argv.includes("--apply");
  const skipScan = process.argv.includes("--skip-scan");
  const workersArg = process.argv.find((a) => a.startsWith("--workers="));
  // Scan defaults to 4 tabs; batch-update auto-scales unless --workers= is set.
  const scanWorkers = workersArg || "--workers=4";
  const batchWorkers = workersArg || "";
  const limit = process.argv.find((a) => a.startsWith("--limit="));

  if (!skipScan) {
    run(`node scripts/grab-chrome-scan.mjs ${scanWorkers}`);
  }

  if (apply) {
    const lim = limit ? ` ${limit}` : "";
    run(`node scripts/grab-chrome-batch-update.mjs --apply ${batchWorkers}${lim}`.replace(/\s+/g, " ").trim());
    run(`node scripts/grab-chrome-scan.mjs ${scanWorkers}`);
  } else {
    run(
      `node scripts/grab-chrome-batch-update.mjs --dry-run ${batchWorkers}${limit ? ` ${limit}` : ""}`
        .replace(/\s+/g, " ")
        .trim(),
    );
  }

  run("node scripts/push-grab-price-tracker-to-sheet.mjs");
  run("node scripts/push-grab-update-plan-to-sheet.mjs");
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
