/**
 * Post-build guard: back-office static routes must exist; POS must NOT ship under /pos/.
 * Run after `npm run build` (includes split-pos-hosting).
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
  "pos-sales",
];

const FORBIDDEN_PUBLIC_FILES = [
  path.join(PUBLIC, "pos.html"),
  path.join(PUBLIC, "pos", "index.html"),
];

const POS_REDIRECT_DEST = "https://telltea-pos.web.app/pos/";

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
if (fs.existsSync(posHtml)) {
  fail(`back-office must not ship /pos/ — found ${posHtml}`);
} else {
  ok("back-office has no /pos/ route");
}

for (const file of FORBIDDEN_PUBLIC_FILES) {
  if (fs.existsSync(file)) {
    fail(
      `Forbidden public file ${path.relative(ROOT, file)} — conflicts with POS hosting`,
    );
  }
}

try {
  const firebase = JSON.parse(fs.readFileSync(path.join(ROOT, "firebase.json"), "utf8"));
  const sites = Array.isArray(firebase.hosting) ? firebase.hosting : [firebase.hosting];
  const main = sites.find((s) => s.target === "telltea");
  const redirects = main?.redirects ?? [];
  const posRedirect = redirects.find(
    (r) => r.source === "/pos" && String(r.destination).startsWith(POS_REDIRECT_DEST),
  );
  if (!posRedirect) {
    fail("firebase.json must 301 redirect /pos → telltea-pos.web.app");
  } else {
    ok("firebase.json /pos → telltea-pos redirect");
  }
  for (const rule of redirects) {
    const dest = String(rule.destination || "");
    if (dest.includes("pos.html")) {
      fail(`firebase.json redirect may loop: ${JSON.stringify(rule)}`);
    }
  }
} catch (err) {
  fail(`Could not read firebase.json: ${err instanceof Error ? err.message : String(err)}`);
}

if (failed) {
  console.error("\nHosting smoke failed — back-office routes at risk.");
  process.exit(1);
}

console.log("\nBack-office hosting export OK — no /pos/ route, redirect configured.");
