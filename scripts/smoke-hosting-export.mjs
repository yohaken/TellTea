/**
 * Post-build guard: POS work must not break TellTea back-office static routes.
 * Run after `npm run build` — fails deploy if exports are missing or /pos/ conflicts.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "out");
const PUBLIC = path.join(ROOT, "public");

/** Core back-office pages — must exist as out/<route>/index.html */
const BACK_OFFICE_ROUTES = [
  "login",
  "ledger",
  "settings",
  "ot",
  "stock",
  "check",
  "staff",
  "tasks",
  "bonus",
  "production",
  "in",
  "more",
  "profile",
  "owner-books",
  "pnl",
  "alerts",
  "export",
];

/** Files that previously caused ERR_TOO_MANY_REDIRECTS on /pos/ */
const FORBIDDEN_PUBLIC_FILES = [
  path.join(PUBLIC, "pos.html"),
  path.join(PUBLIC, "pos", "index.html"),
];

let failed = false;

function fail(msg) {
  console.error("FAIL:", msg);
  failed = true;
}

function ok(msg) {
  console.log("OK", msg);
}

if (!fs.existsSync(OUT)) {
  fail("out/ missing — run npm run build first");
  process.exit(1);
}

const homeHtml = path.join(OUT, "index.html");
if (!fs.existsSync(homeHtml)) {
  fail(`Missing home export: / → ${homeHtml}`);
} else {
  ok("home /");
}

for (const route of BACK_OFFICE_ROUTES) {
  const html = path.join(OUT, route, "index.html");
  if (!fs.existsSync(html)) {
    fail(`Missing back-office export: /${route}/ → ${html}`);
  } else {
    ok(`back-office /${route}/`);
  }
}

const posHtml = path.join(OUT, "pos", "index.html");
if (!fs.existsSync(posHtml)) {
  fail(`Missing POS export: /pos/ → ${posHtml}`);
} else {
  ok("POS /pos/");
}

for (const file of FORBIDDEN_PUBLIC_FILES) {
  if (fs.existsSync(file)) {
    fail(
      `Forbidden public file ${path.relative(ROOT, file)} — conflicts with out/pos/index.html and can 404 or redirect-loop /pos/`,
    );
  }
}

try {
  const firebase = JSON.parse(fs.readFileSync(path.join(ROOT, "firebase.json"), "utf8"));
  const redirects = firebase.hosting?.redirects ?? [];
  for (const rule of redirects) {
    const src = String(rule.source || "");
    const dest = String(rule.destination || "");
    if (src.includes("pos") || dest.includes("pos.html")) {
      fail(`firebase.json redirect may break /pos/: ${JSON.stringify(rule)}`);
    }
  }
  ok("firebase.json has no /pos redirect rules");
} catch (err) {
  fail(`Could not read firebase.json: ${err instanceof Error ? err.message : String(err)}`);
}

if (failed) {
  console.error("\nHosting smoke failed — back-office or POS routes at risk of 404.");
  process.exit(1);
}

console.log("\nHosting export OK — back-office + POS routes present, no pos.html conflict.");
