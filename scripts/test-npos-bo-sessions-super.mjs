/**
 * Gate: BO sessions slim-super — codes + date col, no date slider, 50-row scroll, date newest→oldest,
 * close flush-then-server before local exit.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 548/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 159/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+127/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.104"/);

assert.ok(existsSync(join(root, "docs/npos-bo-sessions-super-checklist.md")));
assert.match(read("docs/npos-bo-sessions-super-checklist.md"), /50|รหัส|closedAt|flush/);

const lib = read("src/lib/pos-sales-report.ts");
assert.match(lib, /POS_SESSIONS_SLIM_LIMIT\s*=\s*50/);
assert.match(lib, /subscribePosSessionsRecent/);
assert.match(lib, /subscribePosSalesRecent/);
assert.match(lib, /sortSessionsNewestFirst/);
assert.match(lib, /posSessionCode/);
assert.match(lib, /orderBy\("openedAt",\s*"desc"\)/);
assert.match(lib, /limit\(/);

const slim = read("src/components/PosSessionsSlimTable.tsx");
assert.match(slim, /เครื่อง/);
assert.match(slim, /รหัสรอบ/);
assert.match(slim, /วันที่/);
assert.match(slim, /ปิดรอบ/);
assert.match(slim, /durationLabel|npos-slim-duration/);
assert.match(slim, /formatPosSessionDuration|posSessionDurationMs/);
assert.match(slim, /onForceClose/);
assert.match(slim, /npos-slim-col-session/);
assert.match(slim, /npos-slim-row--sessions-super/);
assert.match(slim, /npos-slim-scroll--rows/);
assert.match(slim, /closedAt/);
assert.match(slim, /pairingCode|posPairingCodeFromId/);
assert.doesNotMatch(slim, /shortPosSessionId/);

const libOpen = read("src/lib/pos-sales-report.ts");
assert.match(libOpen, /sortSessionsByDateNewestFirst\(\[\.\.\.map\.values\(\)\]\)/);
assert.match(libOpen, /export function inspectPosSessionData/);
assert.match(libOpen, /formatPosSessionDuration/);

const reportUi = read("src/components/PosSalesReport.tsx");
assert.match(reportUi, /inspectPosSessionData/);
assert.match(reportUi, /pos-sales-issue-lead|pos-sales-data-issue-list/);

const slimCopy = read("src/components/PosSessionsSlimTable.tsx");
assert.match(slimCopy, /วันใหม่→เก่า/);

const report = read("src/components/PosSalesReport.tsx");
assert.match(report, /subscribePosSessionsRecent/);
assert.match(report, /subscribePosSalesRecent/);
assert.match(report, /closePosSessionAdmin|forceCloseTargetId/);
assert.match(report, /pos-sales-bills-fold|npos-slim-row--bills-super/);
assert.match(report, /POS_BILLS_SLIM_PAGE|billsVisible/);
assert.doesNotMatch(report, /npos-slim-date-nav|pos-sales-date-nav/);
assert.doesNotMatch(report, /ChevronLeft|dateInputValue|shiftDate/);
assert.doesNotMatch(report, /dateMs/);

const admin = read("src/lib/pos-sales-admin.ts");
assert.match(admin, /closePosSessionAdmin/);
assert.match(admin, /deletePosSessionsAdmin/);
assert.match(admin, /bo-force/);

const css = read("src/app/globals.css");
assert.match(css, /npos-slim-scroll--rows/);
assert.match(css, /npos-slim-row--sessions-super/);
assert.match(css, /npos-slim-row--bills-super/);
assert.match(css, /npos-slim-col-session/);
assert.match(css, /npos-slim-code/);
assert.match(css, /max-height:\s*min\(22rem/);

const flow = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/shift/BlindCloseFlow.java",
);
assert.match(flow, /flushThenCloseSession/);
assert.doesNotMatch(flow, /listPending/);
assert.doesNotMatch(flow, /blind_close_pending_title/);

const sync = read("npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java");
assert.match(sync, /flushThenCloseSession/);
assert.match(sync, /flushPendingBlocking/);
assert.match(sync, /postCloseSession/);
assert.match(sync, /ยังไม่ออกงาน/);

const cf = read("functions/npos-sell.js");
assert.match(cf, /closedAt/);
assert.match(cf, /alreadyClosed|zFinalizedAt/);
assert.match(cf, /startOfBangkokDay\(openedAt\)/);
assert.match(cf, /date:\s*correctDate/);

console.log("OK test-npos-bo-sessions-super");
