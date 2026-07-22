import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const settings = readFileSync(join(root, "src/lib/pos-settings.ts"), "utf8");
assert.match(settings, /local-first/);
assert.match(settings, /flushPosShopSettingsUpload/);
assert.match(settings, /syncPending/);
assert.match(settings, /shopSettingsUpdatedAt/);
assert.match(settings, /savedLocal: true/);
assert.match(settings, /window\.addEventListener\("online"/);
assert.match(settings, /getPosDb\(\)/);
assert.doesNotMatch(settings, /getDb\(\)/);
assert.doesNotMatch(settings, /throw new Error\(mapFirestoreError/);

const view = readFileSync(join(root, "src/components/PosBusinessSettingsView.tsx"), "utf8");
assert.match(view, /จะอัปขึ้น Firebase ทีหลัง/);
assert.match(view, /result\.synced/);
assert.match(view, /บันทึกในเครื่องก่อน/);

const sync = readFileSync(join(root, "src/lib/pos-sync.ts"), "utf8");
assert.match(sync, /flushPosShopSettingsUpload/);

const version = readFileSync(join(root, "src/lib/pos-version.ts"), "utf8");
assert.match(version, /POS_BUILD = 67/);

console.log("OK pos-settings-local-first");
