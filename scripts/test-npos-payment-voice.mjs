/**
 * Gate: O4 Thai cash voice — bundled offline clips (no OEM TTS required).
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.ok(Number(read("src/lib/version.ts").match(/APP_BUILD = (\d+)/)[1]) >= 581);
assert.ok(Number(read("src/lib/pos-version.ts").match(/POS_BUILD = (\d+)/)[1]) >= 166);
assert.ok(Number((read("npos-telltea/app/build.gradle").match(/versionCode\s+(\d+)/) || [])[1]) >= 130);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"\d+"/);
assert.match(read("src/lib/npos-apk-release.ts"), /NPOS_SYSTEM_VERSION_NAME = "\d+"/);
assert.ok(Number((read("src/lib/npos-apk-release.ts").match(/NPOS_SYSTEM_VERSION_CODE = (\d+)/) || [])[1]) >= 130);

const rawDir = join(root, "npos-telltea/app/src/main/res/raw");
assert.ok(existsSync(rawDir));
const clips = readdirSync(rawDir).filter((f) => f.startsWith("voice_") && f.endsWith(".mp3"));
const need = [
  "voice_rab_ma",
  "voice_thon",
  "voice_baht",
  "voice_sun",
  "voice_nueng",
  "voice_song",
  "voice_sam",
  "voice_si",
  "voice_ha",
  "voice_hok",
  "voice_jet",
  "voice_paed",
  "voice_kao",
  "voice_sip",
  "voice_yi",
  "voice_et",
  "voice_roi",
  "voice_phan",
  "voice_muen",
  "voice_saen",
  "voice_lan",
];
for (const name of need) {
  assert.ok(clips.includes(name + ".mp3"), "missing " + name);
}
assert.ok(clips.length >= 21);

const words = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/ThaiCashWords.java",
);
assert.match(words, /keysForBaht/);
assert.match(words, /voice_|sip|roi|et/);

const voice = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/PaymentVoice.java",
);
assert.match(voice, /bundled|res\/raw|R\.raw\.voice_rab_ma/);
assert.match(voice, /MediaPlayer/);
assert.match(voice, /speakCash/);
assert.match(voice, /ThaiCashWords\.keysForBaht/);
assert.doesNotMatch(voice, /TextToSpeech/);

const prefs = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/PaymentVoicePrefs.java",
);
assert.match(prefs, /payment_voice_on_bundled/);
assert.match(prefs, /getBoolean\(KEY_ENABLED,\s*true\)/);

const sell = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(sell, /PaymentVoice\.speakCash/);
assert.match(sell, /PaymentMethods\.isCash\(method\)/);

const settings = read("npos-telltea/app/src/main/java/app/telltea/npos/SettingsActivity.java");
assert.match(settings, /paymentVoiceToggleButton/);
assert.match(settings, /PaymentVoicePrefs\.toggle/);

const strings = read("npos-telltea/app/src/main/res/values/strings.xml");
assert.match(strings, /payment_voice_on_bundled/);
assert.match(strings, /เสียงฝังในแอป|ออฟไลน์/);

assert.match(read("docs/npos-payment-voice-checklist.md"), /bundled|ฝัง|raw\/voice_|ออฟไลน์/);
assert.match(read("scripts/check-npos-shop.mjs"), /payment-voice/);

console.log("OK test-npos-payment-voice");
