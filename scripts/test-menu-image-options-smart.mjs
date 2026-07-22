/**
 * Auto-compress menu images + smart option browse on menu list.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 262/);

const image = read("src/lib/pos-menu-image.ts");
const photo = read("src/components/PosMenuPhotoModule.tsx");
const admin = read("src/components/PosMenuAdmin.tsx");
const editor = read("src/components/PosMenuItemEditor.tsx");
const summary = read("src/lib/pos-menu-option-summary.ts");
const css = read("src/app/globals.css");
const receipts = read("src/lib/receipts.ts");

// —— Image auto-shrink (no hard reject at 2MB) ——
assert.match(image, /preprocessMenuUpload/);
assert.match(image, /compressImageForUpload/);
assert.match(image, /MENU_MAX_RAW_UPLOAD_BYTES = 25/);
assert.match(image, /MENU_PREPROCESS_MAX_EDGE = 2048/);
assert.doesNotMatch(image, /รูปใหญ่เกิน 2MB — ลดขนาดแล้วลองใหม่/);
assert.match(image, /บีบอัดแล้วยังใหญ่เกินไป|ไฟล์ใหญ่เกิน 25MB/);
assert.match(receipts, /export async function compressImageForUpload/);
assert.match(photo, /ใหญ่เกินจะบีบอัดให้อัตโนมัติ/);
assert.match(photo, /prepareMenuItemImage/);

// —— Smart option browse ——
assert.match(summary, /export function summarizeMenuItemOptions/);
assert.match(summary, /groupLabels/);
assert.match(summary, /choiceNames/);
assert.match(admin, /summarizeMenuItemOptions/);
assert.match(admin, /pos-menu-item-opts-line/);
assert.match(admin, /pos-menu-item-opts-panel/);
assert.match(admin, /ดูตัวเลือกของเมนู/);
assert.match(admin, /expandedItemId/);
assert.match(admin, /ยังไม่ผูกตัวเลือก/);
assert.match(editor, /pos-menu-link-group-sub/);
assert.match(editor, /selectionTypeLabel/);
assert.match(editor, /ตัวเลือก/);
assert.match(css, /\.pos-menu-item-opts-panel/);
assert.match(css, /\.pos-menu-link-group-meta/);

// —— Pure summary logic (mirror of helper) ——
function summarizeMenuItemOptions(item, optionGroups) {
  const ids = item.optionGroupIds || [];
  if (!ids.length) return null;
  const byId = new Map(optionGroups.map((g) => [g.id, g]));
  const groups = ids
    .map((id) => byId.get(id))
    .filter((g) => g && g.active !== false)
    .map((g) => {
      const activeChoices = (g.options || []).filter((o) => o.active !== false);
      return {
        id: g.id,
        name: g.name,
        required: g.required === true,
        choiceNames: activeChoices.map((o) => o.name),
        choiceCount: activeChoices.length,
      };
    });
  if (!groups.length) return null;
  const choiceCount = groups.reduce((n, g) => n + g.choiceCount, 0);
  const groupLabels = groups.map((g) => g.name);
  const short = groupLabels.slice(0, 3).join(", ");
  const more = groupLabels.length > 3 ? ` +${groupLabels.length - 3}` : "";
  return {
    groupCount: groups.length,
    choiceCount,
    groups,
    line: `${groups.length} กลุ่ม · ${choiceCount} ตัวเลือก · ${short}${more}`,
  };
}

const groups = [
  {
    id: "g1",
    name: "ความหวาน",
    required: true,
    active: true,
    options: [
      { name: "100%", active: true },
      { name: "50%", active: true },
      { name: "ซ่อน", active: false },
    ],
  },
  {
    id: "g2",
    name: "ท็อปปิ้ง",
    required: false,
    active: true,
    options: [{ name: "ไข่มุก", active: true }],
  },
];

assert.equal(summarizeMenuItemOptions({ optionGroupIds: [] }, groups), null);
const s = summarizeMenuItemOptions({ optionGroupIds: ["g1", "g2"] }, groups);
assert.equal(s.groupCount, 2);
assert.equal(s.choiceCount, 3);
assert.match(s.line, /2 กลุ่ม/);
assert.match(s.line, /3 ตัวเลือก/);
assert.match(s.line, /ความหวาน/);
assert.equal(s.groups[0].choiceNames.length, 2);

console.log("ok: menu-image-options-smart");
