/**
 * Gate: friendly Prompt + NposUi across counter surfaces (mandatory for new UI).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 544/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 156/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+125/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.102"/);

assert.ok(existsSync(join(root, "docs/npos-friendly-ui-checklist.md")));
assert.match(read("docs/npos-friendly-ui-checklist.md"), /NposUi|1\.14\.39/);
assert.match(read("docs/npos-friendly-ui-checklist.md"), /ห้าม|ต้อง/);
assert.ok(existsSync(join(root, ".cursor/rules/npos-friendly-ui.mdc")));
assert.match(read(".cursor/rules/npos-friendly-ui.mdc"), /NposUi|Prompt/);

assert.ok(existsSync(join(root, "npos-telltea/app/src/main/res/font/prompt_regular.ttf")));
assert.ok(existsSync(join(root, "npos-telltea/app/src/main/res/font/prompt_semibold.ttf")));
assert.ok(existsSync(join(root, "npos-telltea/app/src/main/assets/fonts/Prompt-Regular.ttf")));
assert.ok(existsSync(join(root, "npos-telltea/third_party/prompt/OFL.txt")));

assert.match(read("npos-telltea/app/src/main/AndroidManifest.xml"), /Theme\.Npos/);
assert.match(read("npos-telltea/app/src/main/res/values/styles.xml"), /name="Npos"/);
assert.match(read("npos-telltea/app/src/main/res/values/styles.xml"), /Npos\.Btn\.Primary/);
assert.match(read("npos-telltea/app/src/main/res/values/styles.xml"), /prompt_semibold|prompt_bold/);
assert.match(read("npos-telltea/app/src/main/res/values/colors.xml"), /npos_orange/);
assert.match(read("npos-telltea/app/src/main/res/values/colors.xml"), /npos_chrome/);

const fonts = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/ui/NposFonts.java",
);
assert.match(fonts, /applyActivity|prompt_regular|assets\/fonts/);

const nposUi = read("npos-telltea/app/src/main/java/app/telltea/npos/ui/NposUi.java");
assert.match(nposUi, /enum Btn/);
assert.match(nposUi, /primary\(|chip\(|field\(|headerBar\(/);
assert.doesNotMatch(nposUi, /new Button\(/);

const confirmDlg = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/ui/NposConfirmDialog.java",
);
assert.match(confirmDlg, /NposUi\.(primary|ghost)/);
assert.doesNotMatch(confirmDlg, /\.setPositiveButton\s*\(/);

const ui = read("npos-telltea/app/src/main/java/app/telltea/npos/ui/UiScale.java");
assert.match(ui, /72 \* density \* scale/);
assert.match(ui, /44 \* density \* scale/);
assert.match(ui, /padKeyMinPx/);
assert.match(ui, /padKeyMinPxForChrome/);
assert.match(ui, /padAmountMinPx/);
// Pad keys ~45dp scale (shrunk from 64 so cash/float dialogs fit).
assert.match(ui, /45 \* density \* scale/);

const pad = read("npos-telltea/app/src/main/java/app/telltea/npos/ui/NposNumberPad.java");
assert.match(pad, /padKeyMinPxForChrome/);
assert.match(pad, /CHROME_CASH_DP/);
assert.match(pad, /CHROME_CLAIM_DP/);
assert.match(pad, /CHROME_FLOAT_NOTE_DP/);
assert.doesNotMatch(pad, /new Button\(/);

assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/shift/OpenShiftFlow.java"),
  /padAmountMinPx|CHROME_STANDARD_DP/,
);
assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/shift/BlindCloseFlow.java"),
  /CHROME_FLOAT_NOTE_DP|padAmountMinPx/,
);
assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/MainActivity.java"),
  /CHROME_CLAIM_DP/,
);

assert.match(confirmDlg, /fitCardToWindow/);
assert.match(confirmDlg, /containsEditText/);
assert.match(confirmDlg, /SOFT_INPUT_ADJUST_RESIZE/);

const settings = read("npos-telltea/app/src/main/res/layout/activity_settings.xml");
assert.match(settings, /Npos\.Btn\.Primary/);
assert.match(settings, /Npos\.Btn\.Chip/);
assert.match(settings, /npos_banner_peach|Npos\.Banner\.Update/);
assert.match(settings, /HorizontalScrollView/);
assert.doesNotMatch(settings, /<Button\b/);

const settingsJava = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/SettingsActivity.java",
);
assert.match(settingsJava, /NposFonts\.applyActivity/);
assert.match(settingsJava, /TextView updateButton/);
assert.doesNotMatch(settingsJava, /import android\.widget\.Button/);

const main = read("npos-telltea/app/src/main/res/layout/activity_main.xml");
assert.match(main, /Npos\.Btn\.Primary/);
assert.match(main, /prompt_bold|npos_text_brand/);

const sell = read("npos-telltea/app/src/main/res/layout/activity_sell.xml");
assert.match(sell, /payCashButton[\s\S]*Npos\.Btn\.(SellRow\.)?Primary/);
assert.match(sell, /Npos\.Btn\.Chip/);
assert.match(sell, /npos_chrome/);
assert.doesNotMatch(sell, /<Button\b/);

const sellJava = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java",
);
assert.match(sellJava, /NposUi\.(primary|chip|ghost|secondary)/);
assert.doesNotMatch(sellJava, /new Button\(/);
assert.doesNotMatch(sellJava, /Typeface\.DEFAULT/);
assert.doesNotMatch(sellJava, /0xFF2D7FE0|2D7FE0/);
const startPayAll = sellJava.match(/private void startPayAll\(\) \{[\s\S]*?\n  private void startPay\(/);
assert.ok(startPayAll);
assert.doesNotMatch(startPayAll[0], /\.setItems\s*\(/);
assert.match(startPayAll[0], /NposUi\.primary/);
assert.match(read("docs/npos-friendly-ui-checklist.md"), /setItems/);

const picker = read("npos-telltea/app/src/main/res/layout/dialog_option_picker.xml");
assert.match(picker, /prompt_semibold|Npos\.Btn/);
assert.match(picker, /npos_ink|npos_surface/);
assert.doesNotMatch(picker, /minHeight="52dp"/);

const sidebar = read("npos-telltea/app/src/main/res/layout/include_pos_sidebar.xml");
assert.match(sidebar, /npos_chrome|prompt_bold/);

assert.match(
  read("npos-telltea/app/src/main/res/drawable/npos_nav_active.xml"),
  /npos_orange/,
);

const diagnose = read("npos-telltea/app/src/main/res/layout/activity_diagnose.xml");
assert.match(diagnose, /prompt_|Npos\.Btn/);
assert.doesNotMatch(diagnose, /<Button\b/);

const receipts = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/ReceiptsActivity.java",
);
assert.match(receipts, /NposUi/);
assert.match(receipts, /detailRoot|TimeFilter/);
assert.doesNotMatch(receipts, /new Button\(/);

const shift = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/ShiftActivity.java",
);
assert.match(shift, /NposUi/);
assert.doesNotMatch(shift, /new Button\(/);

const menuAdmin = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/MenuAdminActivity.java",
);
assert.match(menuAdmin, /NposUi/);
assert.match(menuAdmin, /MenuSyncCoordinator\.Listener/);
assert.doesNotMatch(menuAdmin, /new Button\(/);
assert.doesNotMatch(menuAdmin, /\.setItems\s*\(/);
assert.doesNotMatch(menuAdmin, /import android\.widget\.Button/);

for (const editPath of [
  "npos-telltea/app/src/main/java/app/telltea/npos/MenuItemEditActivity.java",
  "npos-telltea/app/src/main/java/app/telltea/npos/MenuGroupEditActivity.java",
]) {
  const edit = read(editPath);
  assert.match(edit, /NposUi/);
  assert.doesNotMatch(edit, /new Button\(/);
  assert.doesNotMatch(edit, /\.setItems\s*\(/);
}

const customer = read(
  "npos-telltea/app/src/main/res/layout/presentation_customer.xml",
);
assert.match(customer, /prompt_bold|prompt_semibold/);

assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/shell/PosShellNav.java"),
  /NposFonts/,
);


assert.match(read("npos-telltea/app/src/main/res/values/styles.xml"), /layout_width">wrap_content/);
assert.match(read("npos-telltea/app/src/main/res/values/dimens.xml"), /npos_btn_max_w">280dp/);
assert.match(read("npos-telltea/app/src/main/res/layout/activity_sell.xml"), /Npos\.Btn\.SellRow/);
assert.match(read("npos-telltea/app/src/main/res/layout/activity_sell.xml"), /btn_pay_cash|💵/);
assert.doesNotMatch(read("npos-telltea/app/src/main/res/layout/activity_main.xml"), /maxWidth="999dp"/);
assert.match(read("npos-telltea/app/src/main/res/values/styles.xml"), /Npos\.Btn\.SellRow/);
assert.match(read("npos-telltea/app/src/main/java/app/telltea/npos/ui/NposUi.java"), /static LinearLayout\.LayoutParams cta/);

console.log("OK test-npos-friendly-ui");
