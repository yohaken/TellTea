/**
 * Guard: receipt QR claim phases R0–R2 (owner experiment, no APK).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const members = read("src/lib/members.ts");
assert.match(members, /receiptClaimEnabled: false/);
assert.match(members, /pointsFromReceiptClaim/);
assert.match(members, /earn_receipt_claim/);
assert.match(members, /receipt_qr/);

const claimLib = read("src/lib/receipt-claim.ts");
assert.match(claimLib, /issueReceiptClaimForSale/);
assert.match(claimLib, /publicReceiptClaim/);
assert.match(claimLib, /buildClaimPath/);

const claimPage = read("src/app/claim/page.tsx");
assert.match(claimPage, /sendPhoneOtp/);
assert.match(claimPage, /pdpa/);
assert.match(claimPage, /submitReceiptClaim/);

const boh = read("src/app/members/page.tsx");
assert.match(boh, /receiptClaimEnabled/);
assert.match(boh, /issueReceiptClaimForSale/);
assert.match(boh, /QR สลิป/);
assert.match(boh, /ทดลอง QR สลิป/);

const providers = read("src/components/AppRootProviders.tsx");
assert.match(providers, /isPublicClaim/);

const posMembers = read("functions/pos-members.js");
assert.match(posMembers, /receiptClaimEnabled/);
assert.match(posMembers, /pointsFromReceiptClaim/);
assert.match(posMembers, /previewReceiptClaim/);
assert.match(posMembers, /claimReceiptPoints/);
assert.match(posMembers, /earn_receipt_claim/);

const nposSell = read("functions/npos-sell.js");
assert.match(nposSell, /publicReceiptClaimPreview/);
assert.match(nposSell, /publicReceiptClaim/);

const index = read("functions/index.js");
assert.match(index, /publicReceiptClaimPreview/);
assert.match(index, /publicReceiptClaim/);

const smoke = read("scripts/smoke-hosting-export.mjs");
assert.match(smoke, /"claim"/);

const version = read("src/lib/version.ts");
assert.ok(Number(version.match(/APP_BUILD = (\d+)/)[1]) >= 730);

// Must not ship nPos print / APK bump for R0–R2
assert.equal(
  existsSync(join(root, "npos-telltea/app/src/main/java/app/telltea/npos/sell/MemberApi.java")),
  false,
);
const gradle = read("npos-telltea/app/build.gradle");
assert.match(gradle, /versionCode 137/);

const phases = read("docs/members-receipt-qr-phases.md");
assert.match(phases, /ทดลองโดยเจ้าของเท่านั้น/);
assert.match(phases, /ห้ามข้ามไป R4/);

console.log("OK test-members-receipt-claim");
