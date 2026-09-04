#!/usr/bin/env node
/**
 * Full round: optional scan → apply → rescan sample → push tracker sheet.
 *
 *   node scripts/shopee-price-run.mjs --apply --workers=6
 *   node scripts/shopee-price-run.mjs --apply --workers=6 --skip-scan
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
  const workers = process.argv.find((a) => a.startsWith("--workers=")) || "--workers=10";
  const limit = process.argv.find((a) => a.startsWith("--limit="));

  if (!skipScan) {
    run(`node scripts/shopee-chrome-scan.mjs ${workers}`);
  }

  if (apply) {
    const lim = limit ? ` ${limit}` : "";
    run(`node scripts/shopee-chrome-batch-update.mjs --apply ${workers}${lim}`);
    run(`node scripts/shopee-chrome-scan.mjs ${workers}`);
  } else {
    run(`node scripts/shopee-chrome-batch-update.mjs --dry-run ${workers}`);
  }

  run("node scripts/push-shopee-price-tracker-to-sheet.mjs");
  run("node scripts/push-shopee-update-plan-to-sheet.mjs");
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
