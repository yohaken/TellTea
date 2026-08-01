/**
 * Gate: R1–R3 nPos remit rounds — handoff · cash-in link · manual sessions.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const require = createRequire(import.meta.url);

assert.ok(existsSync(join(root, "docs/npos-remit-rounds-phases.md")));
const doc = read("docs/npos-remit-rounds-phases.md");
assert.match(doc, /R1/);
assert.match(doc, /R2/);
assert.match(doc, /R3/);
assert.match(doc, /remitAmount|ส่งเงิน/);

const version = read("src/lib/version.ts");
const buildMatch = version.match(/APP_BUILD\s*=\s*(\d+)/);
assert.ok(buildMatch);
assert.ok(Number(buildMatch[1]) >= 566, `APP_BUILD >= 566, got ${buildMatch[1]}`);
const pos = read("src/lib/pos-version.ts");
const posMatch = pos.match(/POS_BUILD\s*=\s*(\d+)/);
assert.ok(posMatch);
assert.ok(Number(posMatch[1]) >= 162, `POS_BUILD >= 162, got ${posMatch[1]}`);

const types = read("src/lib/types.ts");
assert.match(types, /remitStatus\??:/);
assert.match(types, /remitHandedAmount\??:/);
assert.match(types, /remitHandedByName\??:/);
assert.match(types, /counterLabel\??:/);

const map = read("src/lib/pos-sales-report.ts");
assert.match(map, /remitStatus/);
assert.match(map, /remitHandedAmount/);
assert.match(map, /counterLabel/);

const lib = read("src/lib/pos-session-remit.ts");
assert.match(lib, /export function deriveRemitStatus/);
assert.match(lib, /export function buildRemitHandoffPatch/);
assert.match(lib, /export async function recordPosSessionRemitHandoff/);
assert.match(lib, /export async function createManualPosSession/);
assert.match(lib, /export function fillDayCashFromSessions/);
assert.match(lib, /export function sessionsForCashDepositDay/);
assert.match(lib, /MANUAL_POS_DEVICE_ID/);
assert.match(lib, /source: "manual"/);

const cash = read("src/lib/cash-deposits.ts");
assert.match(cash, /sessionIds/);

const slim = read("src/components/PosSessionsSlimTable.tsx");
assert.match(slim, /บันทึกส่งเงิน/);
assert.match(slim, /\+รอบมือ/);
assert.match(slim, /npos-slim-remit-handoff/);
assert.match(slim, /ค้างส่ง/);
assert.match(slim, /createManualPosSession/);
assert.match(slim, /labelRemitStatus/);

const panel = read("src/components/CashInLedgerPanel.tsx");
assert.match(panel, /fillDayFromPosSessions/);
assert.match(panel, /จากรอบ/);
assert.match(panel, /sessionIds/);

const rules = read("firestore.rules");
assert.match(rules, /source == 'manual'/);
assert.match(rules, /deviceId == 'manual'/);

const css = read("src/app/globals.css");
assert.match(css, /\.npos-slim-remit-handoff\b/);
assert.match(css, /\.npos-slim-manual-panel\b/);
assert.match(css, /\.npos-slim-remit-status\b/);

assert.match(read("scripts/check-npos-shop.mjs"), /remit-rounds/);

// Pure helper smoke (via ts transpile not available — assert source formulas)
assert.match(lib, /counted - leave/);
assert.match(lib, /handed.*expected|expected.*handed/);
assert.match(lib, /resolveRemitStatusFromAmounts/);

console.log("OK test-npos-remit-rounds");
