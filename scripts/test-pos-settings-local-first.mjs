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
assert.match(settings, /getDb\(\)/);
assert.match(settings, /cloudHasShopFields/);
assert.match(settings, /preferRemoteEmpty/);
assert.match(settings, /adoptRemote/);
assert.match(settings, /syncError/);
// Stale local must not overwrite newer cloud without an explicit pending edit.
assert.doesNotMatch(
  settings,
  /!stored\.syncPending && stored\.updatedAt > remoteAt && remoteAt > 0/,
);

const view = readFileSync(join(root, "src/components/PosBusinessSettingsView.tsx"), "utf8");
assert.match(view, /จะอัปขึ้น Firebase ทีหลัง|ยังไม่ขึ้น Firebase/);
assert.match(view, /result\.synced/);
assert.match(view, /flushPosShopSettingsUpload\("owner"\)/);
assert.match(view, /บันทึกขึ้น Firebase ไม่สำเร็จ/);

const sync = readFileSync(join(root, "src/lib/pos-sync.ts"), "utf8");
assert.match(sync, /flushPosShopSettingsUpload/);

const receipt = readFileSync(
  join(root, "npos-telltea/app/src/main/java/app/telltea/npos/printer/ReceiptFormBuilder.java"),
  "utf8",
);
assert.match(receipt, /do not invent a street address|Prefer live settings/);
assert.doesNotMatch(
  receipt,
  /firstNonEmpty\(opt\(shop, "shopAddress"\), DEFAULT_ADDRESS\)/,
);

const sell = readFileSync(
  join(root, "npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java"),
  "utf8",
);
assert.match(sell, /Refresh shop name\/address|loadShop/);

const version = readFileSync(join(root, "src/lib/pos-version.ts"), "utf8");
assert.match(version, /POS_BUILD = 93/);
assert.match(readFileSync(join(root, "src/lib/version.ts"), "utf8"), /APP_BUILD = 298/);
assert.match(
  readFileSync(join(root, "npos-telltea/app/build.gradle"), "utf8"),
  /versionCode\s+63/,
);

console.log("OK pos-settings-local-first");
