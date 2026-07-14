/**
 * POS update path + chunk recovery wiring (force auto-reload off in production).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/pos-version.ts"), /POS_BUILD\s*=\s*55\b/);
assert.match(read("src/lib/app-release.ts"), /DEV_FORCE_IMMEDIATE_UPDATE\s*=\s*false/);
assert.match(read("src/lib/hard-reload.ts"), /hardReloadWithCacheBust/);
assert.match(read("src/lib/chunk-load-recovery.ts"), /ChunkLoadError/);
assert.match(read("src/lib/chunk-load-recovery.ts"), /installChunkLoadRecovery/);
assert.match(read("src/components/PosUpdateWatcher.tsx"), /DEV_FORCE_IMMEDIATE_UPDATE/);
assert.match(read("src/components/PosUpdateWatcher.tsx"), /setInterval\(tryReload/);
assert.match(read("src/components/AppUpdateWatcher.tsx"), /DEV_FORCE_IMMEDIATE_UPDATE/);
assert.match(read("src/components/PosAppShell.tsx"), /installChunkLoadRecovery/);
assert.match(read("src/components/AppRootProviders.tsx"), /installChunkLoadRecovery/);
assert.match(read("src/lib/pos-app-context.tsx"), /hardReloadWithCacheBust/);

function isStaleChunkFailure(message) {
  return /ChunkLoadError|Loading chunk \d+|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|\/_next\/static\//i.test(
    message,
  );
}
assert.equal(isStaleChunkFailure("ChunkLoadError: Loading chunk 5 failed"), true);
assert.equal(isStaleChunkFailure("Failed to fetch dynamically imported module"), true);
assert.equal(isStaleChunkFailure("TypeError: undefined is not a function"), false);

console.log("test-pos-update-reload-stable: ok");
