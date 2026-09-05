/**
 * Channel names match POS exactly (whitespace/NBSP only). No fold / Jaccard / contains.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { namesEqual } from "./lib/grab-csv.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.equal(namesEqual("ชานมไข่มุก", "ชานมไข่มุก"), true);
assert.equal(namesEqual("ชานมไข่มุก  ", " ชานมไข่มุก"), true);
assert.equal(namesEqual("ชานมไข่มุก\u00a0เย็น", "ชานมไข่มุก เย็น"), true);

assert.equal(namesEqual("ชานมไข่มุก (เย็น/ปั่น)", "ชานมไข่มุก เย็น/ปั่น"), false);
assert.equal(namesEqual(">รสอื่นๆ< (แรนด้อม)", "รสอื่นๆ (แรนด้อม)"), false);
assert.equal(namesEqual("ท้อปปิ้ง", "ท็อปปิ้ง"), false);
assert.equal(namesEqual("ชานม", "ชานมเผือก"), false);
assert.equal(namesEqual("กาแฟ", "ช็อตกาแฟ"), false);

const matchTs = read("src/lib/menu-name-match.ts");
const best = matchTs.slice(matchTs.indexOf("export function bestMatchByName"));
assert.match(best, /namesEqual\(queryName, c\.name\)/);
assert.doesNotMatch(best, /scoreNames/);
assert.doesNotMatch(best, /foldMenuName/);

const hub = read("src/lib/menu-channel-price.ts");
assert.match(hub, /namesEqual\(item\.name, liveName\)/);
assert.match(hub, /namesEqual\(posName, liveName\)/);
assert.doesNotMatch(hub, /foldMenuName/);
assert.doesNotMatch(hub, /scoreNames/);

const ingest = read("scripts/channel-scan-to-hub.mjs");
assert.match(ingest, /namesEqual\(p\.name, it\.name\)/);
assert.match(
  ingest,
  /namesEqual\(liveName, c\.name\) && namesEqual\(liveGroup, c\.groupName\)/,
);
assert.match(ingest, /unmatchedEntries/);
assert.match(ingest, /classifyItemReason/);
assert.match(ingest, /ลบไม่ได้/);
assert.doesNotMatch(ingest, /minScore/);
assert.doesNotMatch(ingest, /foldMenuName/);
assert.doesNotMatch(ingest, /scoreGrabToPos/);

const targets = read("scripts/lib/hub-channel-targets.mjs");
assert.match(targets, /posByName\.get\(normName\(it\.name\)\)/);
assert.doesNotMatch(targets, /bestPosForGrab/);

assert.match(read("scripts/channel-rename-to-pos.mjs"), /namesEqual\(p\.name, name\)/);
assert.match(read("scripts/channel-rename-options-to-pos.mjs"), /if \(!namesEqual\(pg\.name, lg\.name\)\) continue/);
assert.doesNotMatch(read("scripts/channel-rename-options-to-pos.mjs"), /choiceScore/);

assert.match(read("scripts/channel-rename-categories-to-pos.mjs"), /namesEqual\(p, name\)/);
assert.match(read("scripts/channel-rename-categories-to-pos.mjs"), /store\/catalogs\//);

console.log("ok menu name exact");
