/**
 * Gate: O4 Thai cash TTS + settings toggle (no English fallback).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 510/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 142/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+111/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.14\.88"/);
assert.match(read("src/lib/npos-apk-release.ts"), /NPOS_SYSTEM_VERSION_NAME = "1\.14\.88"/);
assert.match(read("src/lib/npos-apk-release.ts"), /NPOS_SYSTEM_VERSION_CODE = 111/);

assert.ok(existsSync(join(root, "docs/npos-payment-voice-checklist.md")));
const doc = read("docs/npos-payment-voice-checklist.md");
assert.match(doc, /TextToSpeech|รับมา|ทอน|O4\./);
assert.match(doc, /ต้องไทย|ไม่ fallback|ไม่มีเสียงไทย/);
assert.match(doc, /1\.14\.88|ship/);

const voice = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/PaymentVoice.java",
);
assert.match(voice, /TextToSpeech/);
assert.match(voice, /new Locale\("th",\s*"TH"\)/);
assert.match(voice, /isLanguageAvailable/);
assert.match(voice, /speakCash/);
assert.match(voice, /รับมา/);
assert.match(voice, /ทอน/);
assert.doesNotMatch(voice, /Locale\.ENGLISH|setLanguage\(Locale\.ENGLISH\)|en_US/);
assert.match(voice, /Never falls back to English|ไม่ fallback|thaiOk|thaiReady/i);

const prefs = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/PaymentVoicePrefs.java",
);
assert.match(prefs, /isEnabled/);
assert.match(prefs, /getBoolean\(KEY_ENABLED,\s*true\)/);
assert.match(prefs, /toggle/);
assert.match(prefs, /statusLabel/);
assert.match(prefs, /thaiReady/);

const sell = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(sell, /PaymentVoice\.speakCash/);
assert.match(sell, /PaymentMethods\.isCash\(method\)/);
assert.match(sell, /onLocalSaved/);

const settings = read("npos-telltea/app/src/main/java/app/telltea/npos/SettingsActivity.java");
assert.match(settings, /paymentVoiceToggleButton/);
assert.match(settings, /PaymentVoicePrefs\.toggle/);
assert.match(settings, /refreshPaymentVoiceSetting/);

const layout = read("npos-telltea/app/src/main/res/layout/activity_settings.xml");
assert.match(layout, /paymentVoiceToggleButton/);
assert.match(layout, /payment_voice_title/);
assert.match(layout, /settings_section_payment/);

const strings = read("npos-telltea/app/src/main/res/values/strings.xml");
assert.match(strings, /payment_voice_on_ready/);
assert.match(strings, /payment_voice_on_no_thai/);
assert.match(strings, /payment_voice_off/);
assert.match(strings, /payment_voice_toggle_btn/);

const app = read("npos-telltea/app/src/main/java/app/telltea/npos/NposApp.java");
assert.match(app, /PaymentVoice\.warm/);

const pad = read("npos-telltea/app/src/main/java/app/telltea/npos/ui/UiScale.java");
assert.match(pad, /padKeyMinPx/);
assert.match(pad, /dp\(density,\s*40\)|Math\.max\(dp\(density,\s*40\)/);

const openUi = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/ui/NposConfirmDialog.java",
);
assert.match(openUi, /customMedium/);
assert.match(openUi, /0\.72f/);
assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/shift/OpenShiftFlow.java"),
  /customMedium/,
);

assert.match(read("docs/npos-counter-ops-phases.md"), /O4/);
assert.match(read("docs/npos-counter-ops-phases.md"), /1\.14\.88/);
assert.match(read("scripts/check-npos-shop.mjs"), /payment-voice/);
assert.match(read("docs/npos-remaining-checklist.md"), /npos-payment-voice-checklist|O4/);

console.log("OK test-npos-payment-voice");
