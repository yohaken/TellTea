/**
 * POS menu cart / option selection tests.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Mirror pos-menu-cart logic for Node (no TS import)
function validateSelections(groups, picked) {
  for (const group of groups) {
    const ids = picked[group.id] || [];
    const activeOptions = group.options.filter((o) => o.active);
    const validIds = new Set(activeOptions.map((o) => o.id));
    const chosen = ids.filter((id) => validIds.has(id));
    if (group.required && chosen.length === 0) return `เลือก "${group.name}" ก่อน`;
    if (!chosen.length) continue;
    if (group.selectionType === "single" && chosen.length > 1) return `"${group.name}" เลือกได้ 1 อย่าง`;
  }
  return null;
}

function computeUnitPrice(basePrice, selections) {
  let extra = 0;
  for (const sel of selections) {
    for (const c of sel.choices) extra += c.priceDelta;
  }
  return Math.round((basePrice + extra) * 100) / 100;
}

const group = {
  id: "g1",
  name: "ท็อปปิ้ง",
  required: true,
  selectionType: "single",
  options: [
    { id: "o1", name: "ไม่รับ", priceDelta: 0, sortOrder: 1, active: true },
    { id: "o2", name: "ไข่มุก", priceDelta: 10, sortOrder: 2, active: true },
  ],
};

assert.equal(validateSelections([group], {}), 'เลือก "ท็อปปิ้ง" ก่อน');
assert.equal(validateSelections([group], { g1: ["o1"] }), null);
assert.equal(
  computeUnitPrice(45, [{ groupId: "g1", groupName: "ท", choices: [{ optionId: "o2", name: "ไข่มุก", priceDelta: 10 }] }]),
  55,
);

const menuSrc = readFileSync(join(root, "src/lib/pos-menu-options.ts"), "utf8");
assert.match(menuSrc, /menuOptionGroups/);

const sellSrc = readFileSync(join(root, "src/components/PosSellView.tsx"), "utf8");
assert.match(sellSrc, /PosOptionPickerModal/);
assert.match(sellSrc, /cartLineToSaleLine/);
assert.match(sellSrc, /onItemClick/);
assert.match(sellSrc, /longPressHandledRef/);

const adminSrc = readFileSync(join(root, "src/components/PosMenuAdmin.tsx"), "utf8");
assert.match(adminSrc, /หมวดหมู่รายการ/);
assert.match(adminSrc, /กลุ่มตัวเลือก/);
assert.match(adminSrc, /PosSortableList/);

const imageSrc = readFileSync(join(root, "src/lib/pos-menu-image.ts"), "utf8");
assert.match(imageSrc, /prepareMenuItemImage/);
assert.match(imageSrc, /renderSquareCoverCrop/);
assert.match(imageSrc, /MENU_SQUARE_PX/);

const cropModalSrc = readFileSync(join(root, "src/components/PosMenuImageCropModal.tsx"), "utf8");
assert.match(cropModalSrc, /PosMenuImageCropModal/);

const optionsSrc = readFileSync(join(root, "src/lib/pos-menu-options.ts"), "utf8");
assert.match(optionsSrc, /serializeMenuOptionChoice/);
assert.match(optionsSrc, /deleteField/);

const itemEditorSrc = readFileSync(join(root, "src/components/PosMenuItemEditor.tsx"), "utf8");
assert.match(itemEditorSrc, /ราคาหน้าร้าน/);
assert.match(itemEditorSrc, /prepareMenuItemImage/);
assert.match(itemEditorSrc, /PosMenuImageCropModal/);

const firebaseJson = readFileSync(join(root, "firebase.json"), "utf8");
assert.match(readFileSync(join(root, "src/components/PosHardLink.tsx"), "utf8"), /location\.assign/);
assert.match(readFileSync(join(root, "src/components/PosAppShell.tsx"), "utf8"), /PosHardLink/);
assert.match(readFileSync(join(root, "src/app/pos/sell/page.tsx"), "utf8"), /PosSellView/);
// Storage rules are allowed (OT photos) — must not be confused with hosting public dirs.
assert.match(firebaseJson, /"storage"\s*:\s*\{\s*"rules"\s*:\s*"storage\.rules"/);

function reorderById(ids, draggedId, targetId) {
  if (draggedId === targetId) return ids;
  const from = ids.indexOf(draggedId);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0) return ids;
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
assert.deepEqual(reorderById(["a", "b", "c"], "a", "c"), ["b", "c", "a"]);

function parseSweetnessPercent(name) {
  const trimmed = name.trim();
  const match = trimmed.match(/(\d+)\s*%/);
  if (match) return Number(match[1]);
  if (/^(ไม่หวาน|ศูนย์|0\s*%|zero)/i.test(trimmed)) return 0;
  return null;
}

function isSweetnessGroup(group) {
  if (/ความหวาน|ระดับความหวาน|หวาน|sweet/i.test(group.name)) return true;
  const active = group.options.filter((o) => o.active);
  if (active.length < 2) return false;
  const withPct = active.filter((o) => parseSweetnessPercent(o.name) != null);
  return withPct.length >= Math.ceil(active.length * 0.6);
}

function sortChoicesForDisplay(group) {
  const active = group.options.filter((o) => o.active);
  if (isSweetnessGroup(group)) {
    return [...active].sort((a, b) => {
      const pa = parseSweetnessPercent(a.name) ?? a.sortOrder;
      const pb = parseSweetnessPercent(b.name) ?? b.sortOrder;
      return pa - pb || a.sortOrder - b.sortOrder;
    });
  }
  return [...active].sort((a, b) => {
    const priceDiff = (a.priceDelta ?? 0) - (b.priceDelta ?? 0);
    if (priceDiff !== 0) return priceDiff;
    return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "th");
  });
}

const sweetGroup = {
  id: "sweet",
  name: "ความหวาน",
  options: [
    { id: "s100", name: "100%", priceDelta: 0, sortOrder: 400, active: true },
    { id: "s0", name: "0%", priceDelta: 0, sortOrder: 100, active: true },
    { id: "s50", name: "50%", priceDelta: 0, sortOrder: 200, active: true },
  ],
};
assert.deepEqual(
  sortChoicesForDisplay(sweetGroup).map((o) => o.name),
  ["0%", "50%", "100%"],
);

const toppingGroup = {
  id: "top",
  name: "ท็อปปิ้ง",
  options: [
    { id: "t2", name: "ไข่มุก", priceDelta: 10, sortOrder: 2, active: true },
    { id: "t1", name: "ไม่รับ", priceDelta: 0, sortOrder: 1, active: true },
    { id: "t3", name: "บุกบราวน์", priceDelta: 5, sortOrder: 3, active: true },
  ],
};
assert.deepEqual(
  sortChoicesForDisplay(toppingGroup).map((o) => o.name),
  ["ไม่รับ", "บุกบราวน์", "ไข่มุก"],
);

const cartSrc = readFileSync(join(root, "src/lib/pos-menu-cart.ts"), "utf8");
assert.match(cartSrc, /sortChoicesForDisplay/);
assert.match(cartSrc, /parseSweetnessPercent/);

const pickerSrc = readFileSync(join(root, "src/components/PosOptionPickerModal.tsx"), "utf8");
assert.match(pickerSrc, /pos-option-sweet-row/);
assert.match(pickerSrc, /pos-option-stepper/);
assert.match(pickerSrc, /pickedCounts/);
assert.match(pickerSrc, /pos-btn-orange/);
assert.match(pickerSrc, /ตกลง/);

assert.match(cartSrc, /selectionKeyFromPickedCounts/);
assert.match(cartSrc, /groupUsesQuantitySteppers/);
assert.match(cartSrc, /validatePickedCounts/);

assert.match(sellSrc, /pos-cart-line-tap/);
assert.match(sellSrc, /pos-cart-head-count/);

function selectionKeyFromPickedCounts(counts) {
  const parts = [];
  for (const [groupId, gc] of Object.entries(counts)) {
    const segment = Object.entries(gc)
      .filter(([, n]) => n > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, n]) => `${id}×${n}`)
      .join(",");
    if (segment) parts.push(`${groupId}:${segment}`);
  }
  return parts.sort().join("|");
}

const unlimitedTopping = {
  id: "top",
  name: "ท็อปปิ้ง",
  required: false,
  selectionType: "unlimited",
  options: [
    { id: "t1", name: "ไข่มุก", priceDelta: 10, sortOrder: 1, active: true },
    { id: "t2", name: "บุกน้ำผึ้ง", priceDelta: 5, sortOrder: 2, active: true },
  ],
};

function validatePickedCounts(groups, counts) {
  for (const group of groups) {
    const gc = counts[group.id] || {};
    const validIds = new Set(group.options.filter((o) => o.active).map((o) => o.id));
    const total = Object.entries(gc)
      .filter(([id, n]) => n > 0 && validIds.has(id))
      .reduce((sum, [, n]) => sum + n, 0);
    if (group.required && total === 0) return `เลือก "${group.name}" ก่อน`;
    if (group.selectionType === "single" && total > 1) return `"${group.name}" เลือกได้ 1 อย่าง`;
  }
  return null;
}

assert.equal(validatePickedCounts([unlimitedTopping], { top: { t1: 2 } }), null);
assert.equal(
  selectionKeyFromPickedCounts({ top: { t1: 2, t2: 1 } }),
  "top:t1×2,t2×1",
);
assert.equal(
  computeUnitPrice(29, [
    {
      groupId: "top",
      groupName: "ท็อปปิ้ง",
      choices: [
        { optionId: "t1", name: "ไข่มุก", priceDelta: 10 },
        { optionId: "t1", name: "ไข่มุก", priceDelta: 10 },
      ],
    },
  ]),
  49,
);

const templateSrc = readFileSync(join(root, "src/lib/pos-printer/receipt-template.ts"), "utf8");
assert.match(templateSrc, /receiptLineBaseName/);
assert.doesNotMatch(templateSrc, /truncate\(line\.name/);

const sortableSrc = readFileSync(join(root, "src/components/PosSortableList.tsx"), "utf8");
assert.match(sortableSrc, /ChevronUp/);
assert.match(sortableSrc, /ChevronDown/);
assert.match(sortableSrc, /moveBy/);
assert.doesNotMatch(sortableSrc, /onPointerDown/);
assert.doesNotMatch(sortableSrc, /GripVertical/);
assert.doesNotMatch(sortableSrc, /draggable/);
assert.match(readFileSync(join(root, "src/app/globals.css"), "utf8"), /pos-sortable-step[\s\S]*touch-action: manipulation/);
assert.doesNotMatch(readFileSync(join(root, "src/app/globals.css"), "utf8"), /\.pos-sortable-handle\s*\{/);

const adminSrcHints = readFileSync(join(root, "src/components/PosMenuAdmin.tsx"), "utf8");
assert.match(adminSrcHints, /กด ↑↓/);
assert.doesNotMatch(adminSrcHints, /ลาก ≡/);

const itemEditorHints = readFileSync(join(root, "src/components/PosMenuItemEditor.tsx"), "utf8");
assert.match(itemEditorHints, /กด ↑↓/);
assert.doesNotMatch(itemEditorHints, /ลาก/);

const groupEditorHints = readFileSync(join(root, "src/components/PosOptionGroupEditor.tsx"), "utf8");
assert.match(groupEditorHints, /กด ↑↓/);
assert.doesNotMatch(groupEditorHints, /ลาก ≡/);

const shiftSrc = readFileSync(join(root, "src/components/PosShiftView.tsx"), "utf8");
assert.match(shiftSrc, /pos-shift-sticky-top/);
assert.match(shiftSrc, /useLiveElapsed/);
assert.match(shiftSrc, /เวลานับเดิน/);
assert.match(shiftSrc, /ออกงาน \(ปิดรอบ\)/);

assert.match(sellSrc, /activeCategories[\s\S]*sortOrder/);

console.log("OK pos-menu-cart");
