/**
 * Guard: OT ⚠ only for incomplete slots, not process-order coaching.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const session = read("src/lib/shift-session.ts");
const page = read("src/app/ot/page.tsx");
const version = read("src/lib/version.ts");

assert.match(version, /APP_BUILD\s*=\s*550/);
assert.match(session, /export function shouldShowOtIncompleteWarn/);
assert.match(session, /export function otIncompleteWarnTitle/);
assert.match(
  session,
  /export function staffProcessOrderHint[\s\S]*?return "";/,
);
assert.match(page, /shouldShowOtIncompleteWarn\(slotProgress\)/);
assert.match(page, /otIncompleteWarnTitle\(slotProgress\)/);
assert.doesNotMatch(page, /staffProcessOrderHint/);
assert.doesNotMatch(page, /hasOtProcessOrderIssue/);
assert.match(page, /SmartCheck \/ SOP กะนี้เช็คแล้ว/);

function shouldShowOtIncompleteWarn(progress) {
  return progress.status === "partial" && progress.missingLabels.length > 0;
}

assert.equal(
  shouldShowOtIncompleteWarn({
    status: "complete",
    missingLabels: [],
  }),
  false,
);
assert.equal(
  shouldShowOtIncompleteWarn({
    status: "partial",
    missingLabels: ["เช็คปิดกะ"],
  }),
  true,
);
assert.equal(
  shouldShowOtIncompleteWarn({
    status: "planned",
    missingLabels: ["ยอดชง"],
  }),
  false,
);

console.log("OK test-ot-incomplete-warn");
