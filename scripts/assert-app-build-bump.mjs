/**
 * Fail when UI/JS source changed but APP_BUILD (or POS_BUILD) was not bumped.
 * Runs in deploy CI so "forgot to bump" cannot ship a silent update (no banner).
 *
 * Compares this commit to HEAD~1 (previous main tip on push).
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function sh(cmd) {
  return execSync(cmd, { cwd: root, encoding: "utf8" }).trim();
}

function readBuildFromText(src, constName) {
  const match = src.match(new RegExp(`export const ${constName} = (\\d+)`));
  return match ? Number(match[1]) : null;
}

function readBuildFile(rel, constName) {
  return readBuildFromText(readFileSync(join(root, rel), "utf8"), constName);
}

let base;
try {
  base = sh("git rev-parse HEAD~1");
} catch {
  console.log("OK assert-app-build-bump · no parent commit — skip");
  process.exit(0);
}

// Committed since base + working tree / index (so local pre-push catches forgot bumps too)
const changed = [
  ...sh(`git diff --name-only ${base} HEAD`).split("\n"),
  ...sh(`git diff --name-only HEAD`).split("\n"),
  ...sh(`git diff --name-only --cached`).split("\n"),
]
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((f, i, arr) => arr.indexOf(f) === i);

const APP_PATHS = [
  /^src\/app\//,
  /^src\/components\//,
  /^src\/lib\//,
  /^src\/hooks\//,
  /^public\/(?!version\.json$|pos-version\.json$)/,
  /^firestore\.rules$/,
  /^firestore\.indexes\.json$/,
];

const POS_PATHS = [
  /^src\/app\/pos\//,
  /^src\/components\/Pos/,
  /^src\/lib\/pos/,
  /^src\/lib\/npos/,
  /^npos-telltea\//,
  /^public\/manifest-pos/,
];

const appTouched = changed.some((f) => APP_PATHS.some((re) => re.test(f)));
const posTouched = changed.some((f) => POS_PATHS.some((re) => re.test(f)));

const appNow = readBuildFile("src/lib/version.ts", "APP_BUILD");
const posNow = readBuildFile("src/lib/pos-version.ts", "POS_BUILD");

let appPrev = null;
let posPrev = null;
try {
  appPrev = readBuildFromText(sh(`git show ${base}:src/lib/version.ts`), "APP_BUILD");
} catch {
  /* new file */
}
try {
  posPrev = readBuildFromText(sh(`git show ${base}:src/lib/pos-version.ts`), "POS_BUILD");
} catch {
  /* new file */
}

const errors = [];

if (appTouched && appPrev != null && appNow <= appPrev) {
  errors.push(
    `UI/JS changed but APP_BUILD not bumped (${appPrev} → ${appNow}). ` +
      `Bump src/lib/version.ts so clients detect the update.`,
  );
}

if (posTouched && posPrev != null && posNow <= posPrev) {
  errors.push(
    `POS sources changed but POS_BUILD not bumped (${posPrev} → ${posNow}). ` +
      `Bump src/lib/pos-version.ts.`,
  );
}

if (errors.length) {
  console.error("FAIL assert-app-build-bump:");
  for (const e of errors) console.error(" -", e);
  console.error("Changed files:\n", changed.filter((f) => APP_PATHS.some((re) => re.test(f)) || POS_PATHS.some((re) => re.test(f))).join("\n"));
  process.exit(1);
}

console.log(
  `OK assert-app-build-bump · APP ${appPrev ?? "?"}→${appNow}` +
    (appTouched ? " (ui touched)" : "") +
    ` · POS ${posPrev ?? "?"}→${posNow}` +
    (posTouched ? " (pos touched)" : ""),
);
