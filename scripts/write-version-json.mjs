/**
 * After `next build`, write /version.json into static export for client polling.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const versionSrc = readFileSync(join(root, "src/lib/version.ts"), "utf8");
const buildMatch = versionSrc.match(/export const APP_BUILD = (\d+)/);
if (!buildMatch) throw new Error("APP_BUILD not found in src/lib/version.ts");

const payload = {
  build: Number(buildMatch[1]),
  builtAt: process.env.NEXT_PUBLIC_APP_BUILT_AT || new Date().toISOString(),
};

const json = `${JSON.stringify(payload, null, 2)}\n`;
for (const dir of ["public", "out"]) {
  writeFileSync(join(root, dir, "version.json"), json, "utf8");
}

console.log(`OK version.json → build ${payload.build}`);
