/**
 * Guard: members P1 — sale fields, void reverse redeem, zero-point claim gate.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const complete = read("functions/pos-complete-sale.js");
assert.match(complete, /manualDiscountBaht/);
assert.match(complete, /tryReverseMemberPointsForVoid/);
assert.match(complete, /แลกแต้มเกินยอดบิลหลังส่วนลด/);

const membersFn = read("functions/pos-members.js");
assert.match(membersFn, /tryReverseRedeemForVoid/);
assert.match(membersFn, /redeem_void_reverse/);
assert.match(membersFn, /tryReverseMemberPointsForVoid/);
assert.match(membersFn, /error: "zero_points"/);

const index = read("functions/index.js");
assert.match(index, /posOwnerReverseSalePoints/);

const types = read("src/lib/types.ts");
assert.match(types, /manualDiscountBaht\?:/);

const admin = read("src/lib/pos-sales-admin.ts");
assert.match(admin, /manualDiscountBaht/);
assert.match(admin, /pointsRedeemed/);
assert.match(admin, /posOwnerReverseSalePoints/);

const report = read("src/lib/pos-sales-report.ts");
assert.match(report, /manualDiscountBaht/);

const claimLib = read("src/lib/receipt-claim.ts");
assert.doesNotMatch(
  claimLib,
  /pointsPreview <= 0\) \{\s*throw new Error\("ยอดบิลนี้ยังคิดแต้มไม่ได้/,
);

const claimPage = read("src/app/claim/page.tsx");
assert.match(claimPage, /no_points/);
assert.match(claimPage, /ไปหน้าสมาชิก/);
assert.match(claimPage, /zero_points/);

const membersPage = read("src/app/members/page.tsx");
assert.match(membersPage, /row\.saleId/);
assert.match(membersPage, /ยอดชำระหลังหักแลกแต้ม/);

const ledgerLabels = read("src/lib/members.ts");
assert.match(ledgerLabels, /redeem_void_reverse/);

const version = read("src/lib/version.ts");
assert.ok(Number(version.match(/APP_BUILD = (\d+)/)[1]) >= 736);

const phases = read("docs/members-round-phases.md");
assert.match(phases, /P1/);

console.log("OK test-members-p1-server");
