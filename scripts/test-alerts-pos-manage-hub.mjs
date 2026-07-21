/**
 * Alerts removed; POS manage tab is empty (placeholder). Web POS admin stays on tablet.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const version = read("src/lib/version.ts");
const more = read("src/app/more/page.tsx");
const alerts = read("src/app/alerts/page.tsx");
const settings = read("src/app/settings/page.tsx");
const posSales = read("src/app/pos-sales/page.tsx");
const report = read("src/components/PosSalesReport.tsx");
const manage = read("src/components/PosManagePanel.tsx");
const shell = read("src/components/AppShell.tsx");
const perms = read("src/lib/permissions.ts");
const settingsLib = read("src/lib/settings.ts");
const rules = read("firestore.rules");
const smoke = read("scripts/smoke-hosting-export.mjs");

assert.match(version, /APP_BUILD = 210/);

assert.match(alerts, /router\.replace\("\/more\/"\)/);
assert.doesNotMatch(more, /href: "\/alerts\/"/);
assert.doesNotMatch(perms, /"alerts"/);
assert.doesNotMatch(settingsLib, /balanceFontSize|actionBtnScale|saveAlertSettings/);
assert.doesNotMatch(shell, /UiSettingsProvider/);
assert.match(shell, /"\/pos-sales"/);
assert.doesNotMatch(shell, /"\/alerts"/);
assert.match(rules, /pushSubscriptions[\s\S]*allow read: if isOwner\(\)/);
assert.doesNotMatch(rules, /hasPerm\('alerts'\)/);
assert.doesNotMatch(smoke, /"alerts"/);

assert.doesNotMatch(settings, /PosDeviceSetup|PosShopPaySetup|PosPrinterSetup|MenuCatalogSetup|PosSalesSetup/);
assert.match(settings, /BusinessProfileSetup/);
assert.doesNotMatch(settings, /ChecklistSetup/);

assert.match(posSales, /Suspense/);
assert.match(report, /จัดการ Pos/);
assert.match(report, /PosManagePanel/);
assert.match(report, /tab=manage/);
assert.doesNotMatch(manage, /MenuCatalogSetup/);
assert.doesNotMatch(manage, /PosDeviceSetup/);
assert.doesNotMatch(manage, /PosOpsNotesSetup/);
assert.doesNotMatch(manage, /PosShopPaySetup/);
assert.doesNotMatch(manage, /PosPrinterSetup/);
assert.match(manage, /NposDevicesPanel/);
assert.match(manage, /NposDiagnosePanel/);
assert.doesNotMatch(manage, /ยังไม่มีรายการจัดการ/);
assert.match(more, /รายงานยอดขาย POS/);

console.log("OK test-alerts-pos-manage-hub");
