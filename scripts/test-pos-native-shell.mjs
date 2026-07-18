/**
 * POS 56 — Capacitor native shell groundwork.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/pos-version.ts"), /POS_BUILD\s*=\s*56\b/);
assert.match(read("src/lib/pos-native.ts"), /isPosNativeShell/);
assert.match(read("capacitor.config.ts"), /app\.telltea\.pos/);
assert.match(read("capacitor.config.ts"), /telltea-pos\.web\.app\/pos/);
assert.match(read("docs/pos-native-shell.md"), /Capacitor/);
assert.ok(existsSync(join(root, "android/app/build.gradle")));
assert.match(read("package.json"), /"cap:sync"/);
assert.match(read("package.json"), /@capacitor\/android/);

console.log("test-pos-native-shell: ok");
