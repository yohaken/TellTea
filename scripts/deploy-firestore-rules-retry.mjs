/**
 * Retry REST rules deploy until success or max attempts.
 * Usage: MAX_ATTEMPTS=30 SLEEP_SEC=60 node scripts/deploy-firestore-rules-retry.mjs
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const max = Number(process.env.MAX_ATTEMPTS || "30");
const sleepSec = Number(process.env.SLEEP_SEC || "60");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

for (let attempt = 1; attempt <= max; attempt++) {
  console.log(`rules REST retry ${attempt}/${max}`);
  const result = spawnSync("node", ["scripts/deploy-firestore-rules-rest.mjs"], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status === 0) {
    const verify = spawnSync("npm", ["run", "verify:firestore-rules"], {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    });
    if (verify.status === 0) {
      console.log("OK rules live verified");
      process.exit(0);
    }
    console.warn("deploy OK but verify failed — retrying");
  }
  if (attempt < max) {
    console.log(`sleep ${sleepSec}s…`);
    await sleep(sleepSec * 1000);
  }
}

console.error(`FAILED after ${max} attempts`);
process.exit(1);
