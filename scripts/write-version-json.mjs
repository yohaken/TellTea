/**
 * After `next build`, write version manifests for client polling.
 * - /version.json — TellTea back-office (APP_BUILD)
 * - /pos-version.json — POS tablet app (POS_BUILD), separate product line
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const builtAt = process.env.NEXT_PUBLIC_APP_BUILT_AT || new Date().toISOString();

function readBuild(file, constName) {
  const src = readFileSync(join(root, file), "utf8");
  const match = src.match(new RegExp(`export const ${constName} = (\\d+)`));
  if (!match) throw new Error(`${constName} not found in ${file}`);
  return Number(match[1]);
}

const appBuild = readBuild("src/lib/version.ts", "APP_BUILD");
const posBuild = readBuild("src/lib/pos-version.ts", "POS_BUILD");

const appPayload = { build: appBuild, builtAt };
const posPayload = { build: posBuild, builtAt, product: "telltea-pos" };

const appJson = `${JSON.stringify(appPayload, null, 2)}\n`;
const posJson = `${JSON.stringify(posPayload, null, 2)}\n`;

for (const dir of ["public", "out"]) {
  writeFileSync(join(root, dir, "version.json"), appJson, "utf8");
  writeFileSync(join(root, dir, "pos-version.json"), posJson, "utf8");
}

console.log(`OK version.json → build ${appBuild}`);
console.log(`OK pos-version.json → POS ${posBuild}`);
