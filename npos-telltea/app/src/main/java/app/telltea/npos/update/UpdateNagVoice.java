package app.telltea.npos.update;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;

import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Idle-only nag while a mandatory APK update is waiting: short tone + Thai TTS when available.
 * Phrase: 「กรุณาอัปเดตโปรแกรม」 every ~3s.
 */
public final class UpdateNagVoice {
  private static final long INTERVAL_MS = 3_000L;
  private static final String PHRASE = "กรุณาอัปเดตโปรแกรม";

  private static final Handler MAIN = new Handler(Looper.getMainLooper());
  private static final AtomicBoolean RUNNING = new AtomicBoolean(false);
  private static ToneGenerator tone;
  private static TextToSpeech tts;
  private static boolean ttsReady;
  private static Context appCtx;

  private static final Runnable TICK =
      new Runnable() {
        @Override
        public void run() {
          if (!RUNNING.get()) return;
          beep();
          speak();
          MAIN.postDelayed(this, INTERVAL_MS);
        }
      };

  private UpdateNagVoice() {}

  public static void start(Context context) {
    if (context == null) return;
    appCtx = context.getApplicationContext();
    ensureTone();
    ensureTts(appCtx);
    if (RUNNING.getAndSet(true)) return;
    MAIN.removeCallbacks(TICK);
    // First cue immediately so staff notice the forced popup.
    MAIN.post(TICK);
  }

  public static void stop() {
    RUNNING.set(false);
    MAIN.removeCallbacks(TICK);
  }

  private static void ensureTone() {
    if (tone != null) return;
    try {
      tone = new ToneGenerator(AudioManager.STREAM_ALARM, 80);
    } catch (Exception ignored) {
      tone = null;
    }
  }

  private static void ensureTts(Context app) {
    if (tts != null) return;
    try {
      tts =
          new TextToSpeech(
              app,
              status -> {
                if (status != TextToSpeech.SUCCESS || tts == null) {
                  ttsReady = false;
                  return;
                }
                int lang = tts.setLanguage(new Locale("th", "TH"));
                ttsReady =
                    lang != TextToSpeech.LANG_MISSING_DATA
                        && lang != TextToSpeech.LANG_NOT_SUPPORTED;
                if (!ttsReady) {
                  // Fallback English locale still helps as attention cue on some OEMs.
                  tts.setLanguage(Locale.getDefault());
                  ttsReady = true;
                }
                try {
                  tts.setAudioAttributes(
                      new AudioAttributes.Builder()
                          .setUsage(AudioAttributes.USAGE_ALARM)
                          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                          .build());
                } catch (Exception ignored) {
                  /* older */
                }
              });
    } catch (Exception e) {
      tts = null;
      ttsReady = false;
    }
  }

  private static void beep() {
    try {
      if (tone != null) {
        tone.startTone(ToneGenerator.TONE_CDMA_ALERT_CALL_GUARD, 220);
      }
    } catch (Exception ignored) {
      /* ignore */
    }
  }

  private static void speak() {
    if (!ttsReady || tts == null) return;
    try {
      tts.speak(PHRASE, TextToSpeech.QUEUE_FLUSH, null, "npos-update-nag");
    } catch (Exception ignored) {
      /* ignore */
    }
  }
}
