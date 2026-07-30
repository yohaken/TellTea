package app.telltea.npos.diagnose;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

import app.telltea.npos.R;

/**
 * Thai cash voice from <b>bundled</b> {@code res/raw/voice_*.mp3} clips — works offline
 * without Google TTS / OEM language packs. Phrase: «รับมา X บาท ทอน Y บาท».
 */
public final class PaymentVoice {
  private static final Object LOCK = new Object();
  private static final AtomicBoolean ready = new AtomicBoolean(false);
  private static Context appCtx;
  private static MediaPlayer player;
  private static final Handler main = new Handler(Looper.getMainLooper());
  private static final List<Integer> queue = new ArrayList<>();
  private static boolean playing;

  private PaymentVoice() {}

  public static void warm(Context context) {
    if (context == null) return;
    Context app = context.getApplicationContext();
    synchronized (LOCK) {
      appCtx = app;
      // Bundled clips are always available once APK is installed.
      ready.set(true);
      PaymentVoicePrefs.setThaiReady(app, true);
    }
  }

  public static void speakCash(Context context, double received, double change) {
    if (context == null) return;
    if (!PaymentVoicePrefs.isEnabled(context)) return;
    warm(context);
    if (received < 0.01) return;
    long recv = Math.round(received);
    if (recv < 1) return;
    long chg = change >= 0.01 ? Math.round(change) : 0L;

    List<Integer> clips = new ArrayList<>();
    clips.add(R.raw.voice_rab_ma);
    addAmount(clips, recv);
    clips.add(R.raw.voice_baht);
    if (chg >= 1) {
      clips.add(R.raw.voice_thon);
      addAmount(clips, chg);
      clips.add(R.raw.voice_baht);
    }
    enqueue(context.getApplicationContext(), clips);
  }

  private static void addAmount(List<Integer> clips, long baht) {
    for (String key : ThaiCashWords.keysForBaht(baht)) {
      int id = rawId(key);
      if (id != 0) clips.add(id);
    }
  }

  private static int rawId(String key) {
    switch (key) {
      case "sun":
        return R.raw.voice_sun;
      case "nueng":
        return R.raw.voice_nueng;
      case "song":
        return R.raw.voice_song;
      case "sam":
        return R.raw.voice_sam;
      case "si":
        return R.raw.voice_si;
      case "ha":
        return R.raw.voice_ha;
      case "hok":
        return R.raw.voice_hok;
      case "jet":
        return R.raw.voice_jet;
      case "paed":
        return R.raw.voice_paed;
      case "kao":
        return R.raw.voice_kao;
      case "sip":
        return R.raw.voice_sip;
      case "yi":
        return R.raw.voice_yi;
      case "et":
        return R.raw.voice_et;
      case "roi":
        return R.raw.voice_roi;
      case "phan":
        return R.raw.voice_phan;
      case "muen":
        return R.raw.voice_muen;
      case "saen":
        return R.raw.voice_saen;
      case "lan":
        return R.raw.voice_lan;
      default:
        return 0;
    }
  }

  private static void enqueue(Context app, List<Integer> clips) {
    if (clips == null || clips.isEmpty()) return;
    main.post(
        () -> {
          synchronized (LOCK) {
            queue.clear();
            queue.addAll(clips);
            stopPlayerLocked();
            playNextLocked(app);
          }
        });
  }

  private static void playNextLocked(Context app) {
    if (queue.isEmpty()) {
      playing = false;
      return;
    }
    int resId = queue.remove(0);
    try {
      MediaPlayer mp = new MediaPlayer();
      player = mp;
      playing = true;
      AssetFileDescriptor afd = app.getResources().openRawResourceFd(resId);
      if (afd == null) {
        playing = false;
        playNextLocked(app);
        return;
      }
      mp.setDataSource(afd.getFileDescriptor(), afd.getStartOffset(), afd.getLength());
      afd.close();
      if (Build.VERSION.SDK_INT >= 21) {
        mp.setAudioAttributes(
            new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build());
      }
      mp.setOnCompletionListener(
          finished ->
              main.post(
                  () -> {
                    synchronized (LOCK) {
                      releasePlayerLocked();
                      playNextLocked(app);
                    }
                  }));
      mp.setOnErrorListener(
          (m, what, extra) -> {
            main.post(
                () -> {
                  synchronized (LOCK) {
                    releasePlayerLocked();
                    playNextLocked(app);
                  }
                });
            return true;
          });
      mp.prepare();
      mp.start();
    } catch (Exception e) {
      releasePlayerLocked();
      OpsLogger.warn(
          app,
          "voice",
          "เล่นคลิปเสียงไม่สำเร็จ",
          e.getMessage() == null ? "" : e.getMessage());
      playNextLocked(app);
    }
  }

  private static void stopPlayerLocked() {
    if (player != null) {
      try {
        player.stop();
      } catch (Exception ignored) {
        /* OEM */
      }
      releasePlayerLocked();
    }
    playing = false;
  }

  private static void releasePlayerLocked() {
    if (player != null) {
      try {
        player.release();
      } catch (Exception ignored) {
        /* OEM */
      }
      player = null;
    }
  }

  public static void shutdown() {
    main.post(
        () -> {
          synchronized (LOCK) {
            queue.clear();
            stopPlayerLocked();
            ready.set(false);
          }
        });
  }

  /** True when bundled clips are installed (always after warm). */
  public static boolean bundledReady() {
    return ready.get();
  }
}
