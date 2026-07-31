/**
 * Gate: /pos-sales layout densify — visual-only, no behavior change.
 * Scoped under .pos-sales-report-page--unified to avoid clash with other agents.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const css = read("src/app/globals.css");
const page = read("src/components/PosSalesReport.tsx");

assert.match(css, /--pos-hub-fs-em:\s*0\.8rem/);
assert.match(css, /--pos-hub-radius:\s*0\.55rem/);
assert.match(
  css,
  /\.pos-sales-report-page--unified\s+\.pos-hub-section-title\s*\{\s*display:\s*none/,
);
assert.match(
  css,
  /\.pos-sales-report-page--unified\s+\.pos-sales-bill-search\s+input\s*\{[^}]*font-size:\s*var\(--pos-hub-fs\)/s,
);
assert.match(
  css,
  /\.pos-sales-report-page--unified\s+\.pos-session-print-docs\s*\{[^}]*padding:\s*var\(--pos-hub-pad-y\)/s,
);
assert.match(
  css,
  /\.pos-sales-report-page--unified\s+\.pos-sales-fold--slim\s*\{[^}]*border-radius:\s*var\(--pos-hub-radius\)/s,
);
assert.match(
  css,
  /\.pos-sales-report-page--unified\s+\.npos-slim-row\s*\{[^}]*padding-top:\s*0\.28rem/s,
);

/* iframe heights must stay (layout chrome only) */
assert.match(css, /\.pos-print-doc-frame-wrap\.is-tall\s+\.pos-print-doc-frame\s*\{\s*height:\s*min\(70vh,\s*40rem\)/);
assert.match(
  css,
  /\.pos-receipt-paper-wrap--compact\s+\.pos-receipt-paper--print-parity\s+\.pos-print-doc-frame\s*\{\s*height:\s*22rem/,
);

/* markup: no duplicate section h2; jump tabs + aria-label remain */
assert.doesNotMatch(page, /pos-hub-section-title/);
assert.match(page, /aria-label="ยอดขาย"/);
assert.match(page, /aria-label="จัดการ"/);
assert.match(page, /npos-bo-page-tabs/);
assert.match(page, /jump\("report"\)/);
assert.match(page, /jump\("manage"\)/);

/* behavior anchors unchanged */
assert.match(page, /PosSessionPrintDocs/);
assert.match(page, /pos-sales-bills-fold/);
assert.match(page, /open=\{billsOpen\}/);

console.log("OK test-pos-sales-layout-slim");
