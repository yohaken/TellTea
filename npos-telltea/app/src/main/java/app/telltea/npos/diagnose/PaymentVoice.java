package app.telltea.npos.diagnose;

import android.content.Context;
import android.os.Build;
import android.speech.tts.TextToSpeech;

import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Thai-only cash voice: «รับมา X บาท ทอน Y บาท».
 * Never falls back to English — if Thai engine missing, stay silent.
 */
public final class PaymentVoice {
  private static final Object LOCK = new Object();
  private static TextToSpeech tts;
  private static final AtomicBoolean ready = new AtomicBoolean(false);
  private static final AtomicBoolean thaiOk = new AtomicBoolean(false);
  private static final AtomicBoolean loggedMissing = new AtomicBoolean(false);
  private static Context appCtx;

  private PaymentVoice() {}

  public static void warm(Context context) {
    if (context == null) return;
    Context app = context.getApplicationContext();
    synchronized (LOCK) {
      appCtx = app;
      if (tts != null) return;
      try {
        tts =
            new TextToSpeech(
                app,
                status -> {
                  if (status != TextToSpeech.SUCCESS) {
                    ready.set(false);
                    thaiOk.set(false);
                    PaymentVoicePrefs.setThaiReady(app, false);
                    return;
                  }
                  Locale th = new Locale("th", "TH");
                  int avail = tts.isLanguageAvailable(th);
                  boolean ok =
                      avail == TextToSpeech.LANG_AVAILABLE
                          || avail == TextToSpeech.LANG_COUNTRY_AVAILABLE
                          || avail == TextToSpeech.LANG_COUNTRY_VAR_AVAILABLE;
                  if (ok) {
                    tts.setLanguage(th);
                    thaiOk.set(true);
                  } else {
                    thaiOk.set(false);
                    if (loggedMissing.compareAndSet(false, true)) {
                      OpsLogger.warn(
                          app,
                          "voice",
                          "ไม่มีเสียงพูดไทยบนเครื่อง",
                          "isLanguageAvailable=" + avail);
                    }
                  }
                  PaymentVoicePrefs.setThaiReady(app, thaiOk.get());
                  ready.set(true);
                });
      } catch (Exception e) {
        ready.set(false);
        thaiOk.set(false);
        PaymentVoicePrefs.setThaiReady(app, false);
        OpsLogger.warn(
            app,
            "voice",
            "เริ่ม TTS ไม่สำเร็จ",
            e.getMessage() == null ? "" : e.getMessage());
      }
    }
  }

  public static void speakCash(Context context, double received, double change) {
    if (context == null) return;
    if (!PaymentVoicePrefs.isEnabled(context)) return;
    warm(context);
    if (!ready.get() || !thaiOk.get() || tts == null) return;
    if (received < 0.01) return;
    String phrase;
    if (change >= 0.01) {
      phrase =
          String.format(
              Locale.US, "รับมา %.0f บาท ทอน %.0f บาท", received, change);
    } else {
      phrase = String.format(Locale.US, "รับมา %.0f บาท", received);
    }
    try {
      if (Build.VERSION.SDK_INT >= 21) {
        tts.speak(phrase, TextToSpeech.QUEUE_FLUSH, null, "npos-cash-" + System.currentTimeMillis());
      } else {
        tts.speak(phrase, TextToSpeech.QUEUE_FLUSH, null);
      }
    } catch (Exception e) {
      OpsLogger.warn(
          context.getApplicationContext(),
          "voice",
          "พูดไม่สำเร็จ",
          e.getMessage() == null ? "" : e.getMessage());
    }
  }

  public static void shutdown() {
    synchronized (LOCK) {
      if (tts != null) {
        try {
          tts.stop();
          tts.shutdown();
        } catch (Exception ignored) {
          /* OEM */
        }
        tts = null;
      }
      ready.set(false);
      thaiOk.set(false);
    }
  }
}
