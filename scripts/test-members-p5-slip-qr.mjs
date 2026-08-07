/**
 * Guard: members P5 — nPos slip member/redeem lines + QR every bill when flag on.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const form = read("npos-telltea/app/src/main/java/app/telltea/npos/printer/ReceiptFormBuilder.java");
assert.match(form, /CLAIM_QR_MARKER/);
assert.match(form, /สแกนสะสมแต้ม|CLAIM_QR_INVITE/);
assert.match(form, /แลกแต้ม/);
assert.match(form, /สมาชิก:/);
assert.match(form, /manualDiscountBaht/);
assert.match(form, /redeemBaht/);

const esc = read("npos-telltea/app/src/main/java/app/telltea/npos/printer/EscPos.java");
assert.match(esc, /appendClaimQr/);
assert.match(esc, /documentReceipt\(String body, String claimUrl\)/);
assert.match(esc, /0x31, 0x43, 0x04/);
assert.match(esc, /0x1D, 0x28, 0x6B/);

const sunmi = read("npos-telltea/app/src/main/java/app/telltea/npos/printer/SunmiInnerPrinter.java");
assert.match(sunmi, /printPlainWithClaimQr/);
assert.match(sunmi, /printBitmap/);
assert.match(sunmi, /QrBitmaps/);

const saleSync = read("npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java");
assert.match(saleSync, /membersReceiptClaimEnabled/);
assert.match(saleSync, /deferPaperForQr|deferQr/);
assert.match(saleSync, /claimUrl/);
assert.match(saleSync, /kickDrawerOnly/);
assert.match(saleSync, /memberName/);

const complete = read("functions/pos-complete-sale.js");
assert.match(complete, /tryIssueReceiptClaimForSale/);
assert.match(complete, /\.\.\.\(claim \|\| \{\}\)/);
assert.match(complete, /memberName/);

const membersFn = read("functions/pos-members.js");
assert.match(membersFn, /tryIssueReceiptClaimForSale/);
assert.match(membersFn, /buildPublicClaimUrl/);
assert.match(membersFn, /telltea-shop\.web\.app\/claim/);

const nposSell = read("functions/npos-sell.js");
assert.match(nposSell, /membersReceiptClaimEnabled/);
assert.match(nposSell, /memberName: body\.memberName/);

const gradle = read("npos-telltea/app/build.gradle");
const ver = gradle.match(/versionCode\s+(\d+)/);
assert.ok(ver && Number(ver[1]) >= 141, "versionCode >= 141");

const apkPin = read("src/lib/npos-apk-release.ts");
assert.ok(Number(apkPin.match(/NPOS_SYSTEM_VERSION_CODE = (\d+)/)[1]) >= 141);

const whats = read("npos-telltea/app/src/main/java/app/telltea/npos/update/WhatsNewCatalog.java");
assert.match(whats, /versionCode == 141/);

const checklist = read("docs/npos-whats-new-checklist.md");
assert.match(checklist, /141/);

const phases = read("docs/members-round-phases.md");
assert.match(phases, /P5/);

const appBuild = Number(read("src/lib/version.ts").match(/APP_BUILD = (\d+)/)[1]);
assert.ok(appBuild >= 746, "APP_BUILD >= 746");
const posBuild = Number(read("src/lib/pos-version.ts").match(/POS_BUILD = (\d+)/)[1]);
assert.ok(posBuild >= 194, "POS_BUILD >= 194");

console.log("OK test-members-p5-slip-qr");
