import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getSeedDb } from "./lib/pos-firebase-seed.mjs";
import { matchManifestRow, buildManifestIndex } from "./lib/menu-image-match.mjs";
import { collection, getDocs } from "firebase/firestore";

const root = join(dirname(fileURLToPath(import.meta.url)), "data/menu-images-import/foodstory-menu-images-20260713");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const { okRows } = buildManifestIndex(manifest.items);

const db = await getSeedDb();
const snap = await getDocs(collection(db, "menuItems"));
const items = snap.docs.map((d) => ({ id: d.id, name: d.data().name, hasImage: Boolean(d.data().imageUrl) }));

let exact = 0;
let prefix = 0;
const unmatched = [];
for (const it of items) {
  const hit = matchManifestRow(it.name, manifest.items);
  if (!hit) unmatched.push(it.name);
  else if (hit.method === "exact" || hit.method === "loose") exact += 1;
  else prefix += 1;
}

console.log(
  JSON.stringify(
    {
      dbItems: items.length,
      dbWithImage: items.filter((i) => i.hasImage).length,
      manifestOk: okRows.length,
      matchExact: exact,
      matchPrefix: prefix,
      unmatchedCount: unmatched.length,
      unmatchedSample: unmatched.slice(0, 15),
    },
    null,
    2,
  ),
);
