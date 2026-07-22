/**
 * nPos ↔ web shot parity: capture live customer, 5s promo, left rail, option picker, update popup.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 264/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+46/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.23"/);
assert.match(read("docs/npos-web-parity-shot-checklist.md"), /P1|P7|5 วิ|แถบซ้าย/);

const capture = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/ScreenCapture.java",
);
assert.match(capture, /live_customer|captureLiveCustomerOrNull/);
assert.match(capture, /activePresentationOrNull/);

const ctrl = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/CustomerDisplayController.java",
);
assert.match(ctrl, /PROMO_ROTATE_MS\s*=\s*5000/);
assert.match(ctrl, /activePresentationOrNull/);

const sellLayout = read("npos-telltea/app/src/main/res/layout/activity_sell.xml");
assert.match(sellLayout, /include_pos_sidebar|posSidebar/);
assert.match(sellLayout, /include_update_popup|updatePopup/);
assert.match(sellLayout, /layout_weight="65"/);
assert.match(sellLayout, /#E85D24/);

assert.ok(
  existsSync(join(root, "npos-telltea/app/src/main/res/layout/include_pos_sidebar.xml")),
);
assert.ok(
  existsSync(join(root, "npos-telltea/app/src/main/res/layout/dialog_option_picker.xml")),
);
assert.ok(
  existsSync(
    join(root, "npos-telltea/app/src/main/java/app/telltea/npos/shell/PosShellNav.java"),
  ),
);
assert.ok(
  existsSync(
    join(root, "npos-telltea/app/src/main/java/app/telltea/npos/update/UpdatePromptController.java"),
  ),
);
assert.ok(
  existsSync(
    join(root, "npos-telltea/app/src/main/java/app/telltea/npos/update/ResumePrefs.java"),
  ),
);

const sidebar = read("npos-telltea/app/src/main/res/layout/include_pos_sidebar.xml");
assert.match(sidebar, /#2A3038/);
assert.match(sidebar, /sidebarNav/);
assert.match(sidebar, /176dp/);

const shell = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/shell/PosShellNav.java",
);
assert.match(shell, /npos_nav_active|2D7FE0|0xFF2D7FE0/);
assert.match(shell, /nav_sell/);
assert.match(shell, /POS_NAV|pos-nav|ACTIVE_SELL|UiScale/);

const sell = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(sell, /PosShellNav/);
assert.match(sell, /UpdatePromptController/);
assert.match(sell, /dialog_option_picker/);
assert.match(sell, /persistWorkBeforeUpdate|HoldCart\.save/);

const update = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/update/UpdatePromptController.java",
);
assert.match(update, /updatePopup/);
assert.match(update, /markResumeSellAfterUpdate/);

const receiver = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/update/InstallResultReceiver.java",
);
assert.match(receiver, /ResumePrefs|resume_sell|MainActivity/);

const main = read("npos-telltea/app/src/main/java/app/telltea/npos/MainActivity.java");
assert.match(main, /maybeResumeSellAfterUpdate|ResumePrefs/);
assert.match(main, /UpdatePromptController/);
assert.match(main, /PosShellNav/);

const webNav = read("src/lib/pos-nav.ts");
assert.match(webNav, /สั่งและชำระเงิน/);
assert.match(webNav, /ประวัติใบเสร็จ/);

console.log("OK test-npos-web-parity-shot");
