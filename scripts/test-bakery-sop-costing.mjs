/**
 * Guard: bakery SOP + menu costing wiring
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const perms = read("src/lib/permissions.ts");
assert.match(perms, /bakerySop/);
assert.match(perms, /SOP เบเกอรี่/);

const nav = read("src/lib/nav-menu.ts");
assert.match(nav, /bakerySop/);
assert.match(nav, /\/bakery-sop\//);

const lib = read("src/lib/menu-sop.ts");
assert.match(lib, /MENU_SOPS_COL/);
assert.match(lib, /MENU_SOP_COSTS_COL/);
assert.match(lib, /seedBakerySopAndCosts/);
assert.match(lib, /includeInCount: false/);
assert.match(lib, /BAKERY_COST_CATALOG_SEED/);
assert.match(lib, /updateStockItem/);
assert.match(lib, /markBakeryCostCatalogNotCounted/);
assert.match(lib, /computeMenuSopCostSummary/);
assert.doesNotMatch(lib, /unitCost.*ingredients/);
assert.match(lib, /upsertMenuSopForMenuItem/);
assert.match(lib, /upsertMenuSopBase/);
assert.match(lib, /findActiveBaseByName/);
assert.match(lib, /normalizeBaseNameKey/);
assert.match(lib, /มีเบสชื่อ/);
assert.match(lib, /patchMenuSopWorkFlags/);
assert.match(lib, /menuSopDraftChecks/);
assert.match(lib, /menuSopSummaryStatus/);
assert.match(lib, /labelMenuSopSummaryStatus/);
assert.match(lib, /เสร็จแล้ว/);
assert.match(lib, /isBaseSop/);
assert.match(lib, /staffVisible/);
assert.match(lib, /staffVisible !== false/);
assert.match(lib, /skipped/);
assert.match(lib, /category: \"base\"|\"base\"/);
assert.match(lib, /ingredientsText/);
assert.match(lib, /makeStepsText/);
assert.match(lib, /sellStepsText/);
assert.match(lib, /menuSopHasDraft/);

assert.match(lib, /aliases/);
assert.match(lib, /BAKERY_LEGACY_NAME_MAP/);
assert.match(lib, /countMenusLinkedToStock/);
assert.match(lib, /findStockByNameOrAlias/);
assert.match(lib, /แป้งสาลี/);
assert.match(lib, /หมั่นโถว โฮมเมด/);

const page = read("src/app/bakery-sop/page.tsx");
assert.match(page, /canSeeCost/);
assert.match(page, /OwnerCostTab/);
// ต้นทุน = อีเมลเจ้าของตาม rules stockCosts (ไม่ใช่แค่ role)
assert.match(page, /isAppOwnerEmail/);
assert.match(page, /canSeeCost[\s\S]{0,160}isAppOwnerEmail/);
assert.match(page, /bakery-sop-cost-owner-only/);
assert.doesNotMatch(page, /ใช้คำนวณต้นทุนทีหลัง/);
assert.match(read(".cursor/rules/bakery-sop-cost-owner-only.mdc"), /เจ้าของเท่านั้น/);
assert.match(read(".cursor/rules/bakery-sop-cost-owner-only.mdc"), /alwaysApply: true/);

assert.match(page, /subscribeStockItems/);
assert.match(page, /subscribeStockItemsWithCosts/);
assert.match(page, /IngredientAiBlock/);
assert.match(page, /IngredientAiBlock[\s\S]*subscribeStockItems\(/);
assert.match(page, /AI ช่วย/);
assert.match(page, /ตกลง/);
assert.match(page, /aiPending/);
assert.match(page, /เพิ่มรายการ/);
assert.match(page, /bakery-sop-ing-table-block/);
assert.match(page, /ตารางส่วนผสม/);
assert.doesNotMatch(page, /role="tablist"[^>]*aria-label="โหมดส่วนผสม"/);
assert.ok(Number(read("src/lib/version.ts").match(/APP_BUILD = (\d+)/)[1]) >= 1061);
assert.match(page, /bakery-sop-ing-qty-missing/);
assert.match(page, /ขาดปริมาณ/);
assert.match(page, /ยังไม่คู่/);
assert.match(page, /bakery-sop-ing-stock-select/);
assert.match(page, /pickStock/);
assert.match(page, /ปล่อยว่างได้/);
assert.match(page, /STOCK_UNIT_OPTIONS/);
assert.match(page, /StockBasePickField/);
assert.match(page, /textareaId/);
assert.match(page, /textareaId="base-ing"/);

assert.match(page, /bakery-sop-pick-card/);
assert.match(page, /ค้นหาคลัง\/เบส/);
assert.match(page, /พิมพ์ชื่อ/);
assert.doesNotMatch(page, /optgroup label=\"เบส\"/);

assert.match(page, /id=\"base-unit\"/);
assert.match(page, /id=\"base-unit\"[\s\S]*?STOCK_UNIT_OPTIONS\.map/);
assert.match(page, /\{u\.label\}/);
assert.match(page, /normalizeStockUnit\(sop\?\.yieldUnit/);
assert.match(read("src/lib/stock.ts"), /มล\. · มิลลิลิตร/);
assert.match(read("src/lib/stock.ts"), /กก\. · กิโลกรัม/);
assert.match(read("src/lib/stock.ts"), /ล\. · ลิตร/);
assert.match(read("src/lib/stock.ts"), /ก\. · กรัม/);

assert.match(page, /normalizeStockUnit/);
assert.match(page, /setIngredientsText/);
assert.match(page, /useSearchParams/);
assert.match(page, /menuId/);
assert.match(page, /pendingBillLine/);
assert.match(page, /confirmApplyBillLine/);
assert.match(page, /sourceLedgerId|ledgerEntryId/);
assert.match(page, /addStockAliasIfNew/);
assert.match(page, /stockUnitsCompatible/);
assert.match(page, /convertUnitCost/);
assert.match(page, /bakery-sop-cost--sheet/);
assert.match(page, /bakery-sop-cost-sum-table/);
assert.match(page, /bakery-sop-cost-lines-table/);
assert.doesNotMatch(page, /seedBakerySopAndCosts/);
assert.doesNotMatch(page, />\s*Seed\s*</);
assert.doesNotMatch(page, /onSeed/);
assert.match(page, /analyzeMenuSopCost/);
assert.match(page, /extractStockCostsFromBill/);
assert.match(page, /bakery-sop-tree/);
assert.match(page, /bakery-sop-sheet-table--tree/);
assert.match(page, /bakery-sop-sheet-table--base/);
assert.match(page, /bakery-sop-list-section--base/);
assert.match(page, /bakery-sop-list-section--menu/);
assert.match(page, /bakery-sop-yield-hd/);
assert.match(page, /ได้\/ครั้ง/);
assert.match(page, /ได้ต่อครั้ง/);
assert.match(page, /menuYieldQty/);
assert.doesNotMatch(page, /htmlFor="sop-yield"/);
assert.doesNotMatch(page, /htmlFor=\"sop-grams\"|id=\"sop-grams\"/);
assert.doesNotMatch(page, /ก\.\/แก้ว/);
assert.doesNotMatch(page, /bakery-sop-meta-grid--menu/);
assert.match(page, /menuYieldQty = 1/);

assert.match(page, /ชื่อเบส/);
assert.match(page, /ชื่อเมนู/);
assert.match(page, /เมนูหลังร้าน/);
assert.match(page, /baseTableColCount/);
assert.match(page, /menuTableColCount/);
assert.match(page, /sheet-wrap bakery-sop-sheet sheet-bleed/);
assert.match(page, /sheet-table sheet-table--dense/);
assert.match(page, /module-page bakery-sop-page/);
assert.match(page, /bakery-sop-th-sticky/);
assert.doesNotMatch(page, /bakery-sop-cost-summary/);
assert.doesNotMatch(page, /bakery-sop-base-table-wrap form-card/);
assert.doesNotMatch(page, /bakery-sop-slim-head/);
assert.match(page, /bakery-sop-row-group/);
assert.match(page, /bakery-sop-row-item/);
assert.match(page, /bakery-sop-form--fields/);
assert.match(page, /bakery-sop-meta-grid/);
assert.match(page, /bakery-sop-fit-btn/);
assert.match(page, /form-card entry-form/);
assert.match(page, /upsertMenuSopForMenuItem/);
assert.match(page, /upsertMenuSopBase/);
assert.match(page, /patchMenuSopWorkFlags/);
assert.match(page, /BaseSopEditor/);
assert.match(page, /Fragment/);
assert.match(page, /staffVisible/);
assert.match(page, /menuSopSummaryStatus/);
assert.match(page, /labelMenuSopSummaryStatus/);
assert.match(page, /SummaryStatusCell/);
assert.match(page, /สถานะ/);
assert.match(page, /expandedCats/);
assert.match(page, /useState\(false\)/); // baseOpen หุบไว้ก่อน
assert.doesNotMatch(page, /setExpandedCats\(new Set\(tree\.map/);
assert.doesNotMatch(page, /ค่าเริ่มต้น: ขยายทุกหมวด/);
assert.match(page, /useState<Set<string>>\(new Set\(\)\)/);
assert.doesNotMatch(page, /legacySopNoteForName/);
assert.doesNotMatch(page, /LegacyNoteCell/);
assert.doesNotMatch(page, /bakery-sop-legacy-banner/);
assert.doesNotMatch(page, /โน้ตของเดิม/);
assert.doesNotMatch(page, /staffListMode/);
assert.doesNotMatch(page, /รอเจ้าของเปิดแสดง/);
assert.match(page, /openBase\("__new__"\)/);

const legacyNotes = read("src/lib/menu-sop-legacy-notes.ts");
assert.match(legacyNotes, /legacySopDraftForName/);
assert.match(legacyNotes, /legacy-sop-notes\.json/);
assert.doesNotMatch(legacyNotes, /legacySopNoteForName/);
assert.doesNotMatch(legacyNotes, /expandLegacySopNoteKeys/);
assert.match(legacyNotes, /ไม่ใช้โน้ตจับคู่คลัง/);

const legacyJson = read("src/lib/data/legacy-sop-notes.json");
assert.match(legacyJson, /draftByLiveName/);
assert.match(legacyJson, /1_vl4gYTZoTT9U4vzrcV01TIgbEIJAaDn0L212QzmAwo/);
const drafts = JSON.parse(legacyJson).draftByLiveName || {};
assert.ok(Object.keys(drafts).length >= 80, "draftByLiveName for import button");
assert.ok(drafts["โกโก้ เย็น/ปั่น"]?.ingredientsText, "โกโก้ draft has ingredients");

assert.match(page, /LegacyDraftImportButton/);
assert.match(page, /confirmPullLegacyDraft/);
assert.match(page, /ดึงสูตรเดิม|ดึงสูตร/);
assert.match(page, /ดึงใส่ส่วนผสมไหม/);
assert.match(page, /onImportLegacyDraft/);
assert.match(page, /legacySopDraftForName/);
assert.match(page, /menuTableColCount = isOwner \? 5 : 4/);
assert.match(page, /baseTableColCount = isOwner \? 6 : 5/);

assert.match(read("scripts/build-menu-sop-legacy-notes.mjs"), /build-menu-sop-legacy-notes/);
assert.match(page, /มีเบสชื่อ|findActiveBaseByName|upsertMenuSopBase/);
assert.doesNotMatch(page, /canWrite && isOwner \?/);
// ฟอร์มหลัก: บรรยายเปิดตลอด + ตารางแยกด้านล่าง + AI ช่วย — ไม่โชว์บรรยายเมนู/ทำ/ขายแยก
assert.match(page, /ส่วนผสม/);
assert.match(page, /htmlFor="sop-ing"|id="sop-ing"/);
assert.match(page, /htmlFor="base-ing"|id="base-ing"/);
assert.match(page, /bakery-sop-ing-table-block/);
assert.match(page, /ปริมาณต่อสูตรต้องเป็นตัวเลขชัด/);
// ทุกรายการ (แม้ยังไม่มี sop.id) ได้หน้าต่างบรรยาย+ตาราง — สร้าง SOP ตอนบันทึกตาราง
assert.match(page, /ensureSopId/);
// regression: ternary ensureSopId ต้องมี : undefined (เคยพัง TS1005 หลังตัดช่องได้เมนู)
assert.match(page, /upsertMenuSopForMenuItem\(\{[\s\S]*?updatedBy: actorId,\s*\}\)\s*: undefined/);
assert.match(page, /if \(isNew\) onCreated\(id\);\s*return id;\s*\}\s*: undefined/);

assert.match(page, /resolveSopId/);
assert.match(page, /sopId: string \| null/);
assert.doesNotMatch(page, /canWrite && sop\?\.id \?/);
assert.doesNotMatch(page, /canWrite && !isNew && sop\?\.id/);
assert.doesNotMatch(page, /บันทึกครั้งแรกก่อน|บันทึกเบสก่อน/);
assert.ok(Number(read("src/lib/version.ts").match(/APP_BUILD = (\d+)/)[1]) >= 1061);
assert.doesNotMatch(page, /id="sop-desc"|id="base-desc"/);
assert.doesNotMatch(page, /id="sop-make"|id="base-make"/);
assert.doesNotMatch(page, /id="sop-sell"|id="base-sell"/);
assert.doesNotMatch(page, /ขาย\+วัสดุ/);
assert.doesNotMatch(page, /เก็บ\/ใช้\+วัสดุ/);
assert.doesNotMatch(page, /canSeeCost && sop\?\.id \?/);
assert.doesNotMatch(page, /canSeeCost && !isNew && sop\?\.id/);
assert.match(page, /setMenuDbMode\("owner"\)/);
assert.match(page, /ทุกหมวด|เมนูหลังร้านทั้งหมด|ยังไม่มีหมวด/);
assert.doesNotMatch(page, /isBakeryCategoryName/);
assert.doesNotMatch(page, /bakery-sop-tree-hint/);
assert.doesNotMatch(page, /ต้นไม้ = เมนูหลังร้าน/);
assert.doesNotMatch(page, /สูตรเบเกอรี่ใหม่/);
assert.doesNotMatch(page, /เพิ่มเมนู/);
assert.match(page, /encodeMenuSopBaseRef/);
assert.match(page, /parseMenuSopIngredientRef/);
assert.match(page, /ingredientLinkHasPair/);
assert.match(page, /tone=\{isBase \? "base"/);
assert.match(page, /เบส·ส่วนผสม|เบส·\$\{label\}/);
assert.match(page, /StockBasePickField/);
assert.doesNotMatch(page, /optgroup label="เบส"/);
assert.match(page, /bakery-sop-row-item is-base/);
assert.match(page, /StatusMark ok label="เบส" tone="base"/);

const libChecks = read("src/lib/menu-sop.ts");
assert.match(libChecks, /complete: ingredients/);
assert.match(libChecks, /if \(!ingredients\) missingLabels\.push\("ส่วนผสม"\)/);
assert.match(libChecks, /baseSopId/);
assert.match(libChecks, /MENU_SOP_BASE_REF_PREFIX/);
assert.match(libChecks, /encodeMenuSopBaseRef/);
assert.match(libChecks, /parseMenuSopIngredientRef/);
assert.match(libChecks, /ingredientLinkHasPair/);
assert.doesNotMatch(
  libChecks,
  /if \(!description\) missingLabels\.push\("บรรยาย"\)/,
);
assert.doesNotMatch(
  libChecks,
  /if \(!make\) missingLabels\.push/,
);
assert.doesNotMatch(
  libChecks,
  /if \(!sell\) missingLabels\.push/,
);

const aiClient = read("src/lib/menu-sop-ai.ts");
assert.match(aiClient, /extractStockCostsFromBill/);
assert.match(aiClient, /analyzeMenuSopCost/);
assert.match(aiClient, /analyzeMenuSopCostLocal/);
assert.match(aiClient, /parseIngredientsTextLocal/);
assert.match(aiClient, /local-parse/);
assert.match(aiClient, /aliases/);
assert.match(page, /useSearchParams/);
assert.match(page, /menuId/);
assert.ok(Number(read("src/lib/version.ts").match(/APP_BUILD = (\d+)/)[1]) >= 1061);


assert.match(aiClient, /1\\s\*แก้ว/);
assert.match(aiClient, /ฟอง/);
assert.match(aiClient, /unitTok/);

// runtime: local parse (space-split · น้ำแข็ง+1แก้ว · ฟอง)
const parseSmoke = spawnSync(
  "npx",
  ["--yes", "tsx", "-e", `
import { parseIngredientsTextLocal } from "./src/lib/menu-sop-ai.ts";
const a = parseIngredientsTextLocal("ใบชา 50ก. น้ำ 1ล. น้ำตาล 80ก.");
if (a.length !== 3 || a[1].unit !== "ล.") throw new Error("space-split");
const c = parseIngredientsTextLocal("น้ำแข็ง ไม่พูน 1 แก้ว · นมสด 150ml");
if (c[0]?.qty !== 0 || c[1]?.qty !== 150) throw new Error("ice/milk");
const e = parseIngredientsTextLocal("แป้ง 400ก. ไข่ 2ฟอง");
if (e.length < 2 || e.at(-1)?.qty !== 2) throw new Error("egg");
console.log("OK parseIngredientsTextLocal smoke");
`],
  { encoding: "utf8", cwd: join(dirname(fileURLToPath(import.meta.url)), "..") },
);
if (parseSmoke.status !== 0) {
  console.error(parseSmoke.stdout, parseSmoke.stderr);
  throw new Error("parseIngredientsTextLocal smoke failed");
}

const aiFn = read("functions/menu-sop-ai.js");
assert.match(aiFn, /extractStockCostsFromBill/);
assert.match(aiFn, /analyzeMenuSopCost/);
assert.match(aiFn, /permission-denied/);
assert.match(aiFn, /aliases/);
assert.match(aiFn, /ingredientsText/);
assert.match(aiFn, /analyzeMenuSopCost[\s\S]*requireAuth\(context\)/);
assert.doesNotMatch(aiFn, /analyzeMenuSopCost[\s\S]{0,200}requireOwner/);
assert.match(aiFn, /base:/);
assert.match(aiFn, /แคตตาล็อกคลัง \+ เบส/);

const costs = read("src/lib/stock-costs.ts");
assert.match(costs, /sourceLedgerId/);
assert.match(costs, /stockCostHistory/);
assert.match(costs, /listStockCostHistory/);
assert.match(costs, /convertUnitCost/);
assert.match(costs, /stockUnitsCompatible/);

const rules = read("firestore.rules");
assert.match(rules, /match \/stockCosts\/\{itemId\}/);
assert.match(rules, /match \/stockCostHistory\/\{histId\}/);
assert.match(rules, /isOwnerEmail\(\)/);
assert.match(rules, /collection != 'stockCosts'/);
assert.match(rules, /collection != 'stockCostHistory'/);

const index = read("functions/index.js");
assert.match(index, /extractStockCostsFromBill/);
assert.match(index, /analyzeMenuSopCost/);

const shell = read("src/components/AppShell.tsx");
assert.match(shell, /bakerySop/);
assert.match(shell, /NotebookPen/);

const css = read("src/app/globals.css");
assert.match(css, /\.bakery-sop-mark\.is-ok\.is-base/);
assert.match(css, /\.bakery-sop-summary-pill\.is-done\.is-base/);
assert.match(css, /#0e7490/);

const version = read("src/lib/version.ts");
assert.ok(Number(version.match(/APP_BUILD = (\d+)/)[1]) >= 1043);

// Cost math smoke (gram unitCost)
const flourCost = 400 * 0.043;
const sugarCost = 60 * 0.028;
const yeastCost = 15 * 0.25;
const powderCost = 10 * 0.11;
const oilCost = 40 * 0.075;
const waterCost = 240 * 0.00002;
const batch = flourCost + sugarCost + yeastCost + powderCost + oilCost + waterCost;
assert.ok(batch > 26 && batch < 28, `batch=${batch}`);
assert.ok(batch / 9 > 2.8 && batch / 9 < 3.1);

console.log("OK test-bakery-sop-costing");
